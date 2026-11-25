// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AgentGate} from "./AgentGate.sol";
import {CensusToken} from "./CensusToken.sol";
import {
    InsufficientLiquidity,
    MathOverflow,
    NoLiquidity,
    NotOwner,
    OnlyPool,
    Reentrancy,
    Slippage,
    TransferFailed,
    ValueMismatch,
    WrongMarket,
    ZeroAccount,
    ZeroAmount
} from "./Errors.sol";
import {IAgentId} from "./IAgentId.sol";
import {ISeatAgent} from "./ISeatAgent.sol";
import {TurnSeatBook} from "./TurnSeatBook.sol";

/// @notice 第二册恒定乘积池。交换前先跑 beforeSwap：本块已成交越多，费率越高。
/// 基础 30 bps，每多一笔加 10 bps 的一半，上限 100 bps。本窗口席位本人不加这段拥挤费。
/// 手续费留在储备里，按份额取出时一起带走。没有金库，没有管理员提款。
contract TurnSeatPool {
    uint256 public constant BPS = 10_000;
    uint256 public constant BASE_FEE_BPS = 30;
    uint256 public constant CONGESTION_STEP_BPS = 10;
    uint256 public constant MAX_FEE_BPS = 100;
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    CensusToken public immutable token;
    ISeatAgent public immutable agent;
    TurnSeatBook public immutable book;

    uint256 public tokenReserve;
    uint256 public bnbReserve;
    uint256 public lpSupply;
    mapping(address => uint256) public lpOf;

    uint256 public congestionBlock;
    uint256 public swapsInBlock;

    uint256 private _locked;

    event LiquidityAdded(address indexed agent, uint256 tokenAmount, uint256 bnbAmount, uint256 lp);
    event LiquidityRemoved(address indexed agent, uint256 tokenAmount, uint256 bnbAmount, uint256 lp);
    event Swapped(
        address indexed who,
        uint256 indexed agentId,
        bool tokenToBnb,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeBps,
        uint256 priorSwaps
    );

    modifier lock() {
        if (_locked == 1) revert Reentrancy();
        _locked = 1;
        _;
        _locked = 0;
    }

    constructor(address token_, address agent_, address book_) {
        if (token_ == address(0) || agent_ == address(0) || book_ == address(0)) revert ZeroAccount();
        if (TurnSeatBook(book_).token() != CensusToken(token_)) revert WrongMarket();
        token = CensusToken(token_);
        agent = ISeatAgent(agent_);
        book = TurnSeatBook(book_);
    }

    function quoteFee(uint256 priorSwaps, bool seatHolder) public pure returns (uint256 feeBps) {
        if (priorSwaps > 10_000) priorSwaps = 10_000;
        uint256 extra = priorSwaps * CONGESTION_STEP_BPS;
        if (seatHolder) extra = 0;
        else extra /= 2;
        feeBps = BASE_FEE_BPS + extra;
        if (feeBps > MAX_FEE_BPS) feeBps = MAX_FEE_BPS;
    }

    function previewFee(address who, uint256 agentId) public view returns (uint256 feeBps, uint256 prior) {
        prior = block.number == congestionBlock ? swapsInBlock : 0;
        feeBps = quoteFee(prior, book.isCurrentSeat(agentId, who));
    }

    function quoteSwap(bool tokenToBnb, uint256 amountIn, address who, uint256 agentId)
        external
        view
        returns (uint256 amountOut, uint256 feeBps)
    {
        if (amountIn == 0) revert ZeroAmount();
        if (tokenReserve == 0 || bnbReserve == 0) revert NoLiquidity();
        (feeBps,) = previewFee(who, agentId);
        uint256 inAfter = amountIn * (BPS - feeBps) / BPS;
        if (tokenToBnb) amountOut = _amountOut(inAfter, tokenReserve, bnbReserve);
        else amountOut = _amountOut(inAfter, bnbReserve, tokenReserve);
    }

    /// @notice 只由本池的 swap 在交换前调用。记下本块成交笔数，并返回这一笔的费率。
    function beforeSwap(address who, uint256 agentId) external returns (uint256 feeBps, uint256 prior) {
        if (msg.sender != address(this)) revert OnlyPool();
        if (block.number != congestionBlock) {
            congestionBlock = block.number;
            swapsInBlock = 0;
        }
        prior = swapsInBlock;
        feeBps = quoteFee(prior, book.isCurrentSeat(agentId, who));
        swapsInBlock = prior + 1;
    }

    function addLiquidity(uint256 tokenAmount, uint256 minLpOut, uint256 agentId)
        external
        payable
        lock
        returns (uint256 lpOut)
    {
        _identity(agentId);
        if (tokenAmount == 0 || msg.value == 0) revert ZeroAmount();
        _pullTokens(tokenAmount);

        uint256 lpMint;
        uint256 tokenUsed;
        uint256 bnbUsed;
        if (lpSupply == 0) {
            if (tokenAmount > type(uint256).max / msg.value) revert MathOverflow();
            lpMint = _sqrt(tokenAmount * msg.value);
            if (lpMint <= MINIMUM_LIQUIDITY) revert InsufficientLiquidity();
            lpOf[address(this)] = MINIMUM_LIQUIDITY;
            lpOut = lpMint - MINIMUM_LIQUIDITY;
            tokenUsed = tokenAmount;
            bnbUsed = msg.value;
        } else {
            uint256 lpFromToken = tokenAmount * lpSupply / tokenReserve;
            uint256 lpFromBnb = msg.value * lpSupply / bnbReserve;
            lpMint = lpFromToken < lpFromBnb ? lpFromToken : lpFromBnb;
            if (lpMint == 0) revert InsufficientLiquidity();
            lpOut = lpMint;
            tokenUsed = lpMint * tokenReserve / lpSupply;
            bnbUsed = lpMint * bnbReserve / lpSupply;
            if (tokenUsed == 0 || bnbUsed == 0) revert InsufficientLiquidity();
        }
        if (lpOut < minLpOut) revert Slippage();

        lpOf[msg.sender] += lpOut;
        lpSupply += lpMint;
        tokenReserve += tokenUsed;
        bnbReserve += bnbUsed;

        uint256 tokenRefund = tokenAmount - tokenUsed;
        uint256 bnbRefund = msg.value - bnbUsed;
        if (tokenRefund != 0) token.transfer(msg.sender, tokenRefund);
        if (bnbRefund != 0) _send(msg.sender, bnbRefund);
        emit LiquidityAdded(msg.sender, tokenUsed, bnbUsed, lpOut);
    }

    function removeLiquidity(uint256 lpAmount, uint256 minTokenOut, uint256 minBnbOut, uint256 agentId)
        external
        lock
        returns (uint256 tokenOut, uint256 bnbOut)
    {
        _identity(agentId);
        if (lpAmount == 0 || lpAmount > lpOf[msg.sender]) revert ZeroAmount();
        tokenOut = lpAmount * tokenReserve / lpSupply;
        bnbOut = lpAmount * bnbReserve / lpSupply;
        if (tokenOut == 0 || bnbOut == 0) revert InsufficientLiquidity();
        if (tokenOut < minTokenOut || bnbOut < minBnbOut) revert Slippage();

        lpOf[msg.sender] -= lpAmount;
        lpSupply -= lpAmount;
        tokenReserve -= tokenOut;
        bnbReserve -= bnbOut;

        token.transfer(msg.sender, tokenOut);
        if (bnbOut != 0) _send(msg.sender, bnbOut);
        emit LiquidityRemoved(msg.sender, tokenOut, bnbOut, lpAmount);
    }

    function swap(bool tokenToBnb, uint256 amountIn, uint256 minAmountOut, uint256 agentId)
        external
        payable
        lock
        returns (uint256 amountOut)
    {
        _identity(agentId);
        if (amountIn == 0) revert ZeroAmount();
        if (tokenReserve == 0 || bnbReserve == 0) revert NoLiquidity();
        if (tokenToBnb) {
            if (msg.value != 0) revert ValueMismatch();
        } else if (msg.value != amountIn) {
            revert ValueMismatch();
        }

        (uint256 feeBps, uint256 prior) = this.beforeSwap(msg.sender, agentId);
        uint256 inAfter = amountIn * (BPS - feeBps) / BPS;

        if (tokenToBnb) {
            _pullTokens(amountIn);
            amountOut = _amountOut(inAfter, tokenReserve, bnbReserve);
            if (amountOut == 0 || amountOut < minAmountOut || amountOut >= bnbReserve) revert Slippage();
            tokenReserve += amountIn;
            bnbReserve -= amountOut;
            _send(msg.sender, amountOut);
        } else {
            amountOut = _amountOut(inAfter, bnbReserve, tokenReserve);
            if (amountOut == 0 || amountOut < minAmountOut || amountOut >= tokenReserve) revert Slippage();
            bnbReserve += amountIn;
            tokenReserve -= amountOut;
            token.transfer(msg.sender, amountOut);
        }
        emit Swapped(msg.sender, agentId, tokenToBnb, amountIn, amountOut, feeBps, prior);
    }

    function _identity(uint256 agentId) internal {
        AgentGate.check(IAgentId(address(agent)), msg.sender);
        if (agent.ownerOf(agentId) != msg.sender) revert NotOwner();
    }

    function _pullTokens(uint256 amount) internal {
        uint256 beforeBal = token.balanceOf(address(this));
        token.transferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBal != amount) revert MathOverflow();
    }

    function _amountOut(uint256 amountInAfterFee, uint256 reserveIn, uint256 reserveOut)
        internal
        pure
        returns (uint256)
    {
        if (amountInAfterFee == 0) return 0;
        return reserveOut * amountInAfterFee / (reserveIn + amountInAfterFee);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
