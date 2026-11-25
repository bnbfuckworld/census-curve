// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AgentGate} from "./AgentGate.sol";
import {CensusToken} from "./CensusToken.sol";
import {
    InsufficientLiquidity,
    MathOverflow,
    NoLiquidity,
    Reentrancy,
    Slippage,
    TransferFailed,
    ValueMismatch,
    ZeroAccount,
    ZeroAmount
} from "./Errors.sol";
import {IAgentId} from "./IAgentId.sol";

/// @notice Constant-product pool. The 0.3% fee stays in the reserves, so it
/// accrues to LP shares. There is no treasury and no creator fee.
/// LP shares are an internal balance: they are not a transferable token.
contract CensusPool {
    uint256 public constant FEE_NUMERATOR = 997;
    uint256 public constant FEE_DENOMINATOR = 1000;
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    CensusToken public immutable token;
    IAgentId public immutable agent;

    uint256 public tokenReserve;
    uint256 public bnbReserve;
    uint256 public lpSupply;
    mapping(address => uint256) public lpOf;

    uint256 private _locked;

    event LiquidityAdded(address indexed agent, uint256 tokenAmount, uint256 bnbAmount, uint256 lp);
    event LiquidityRemoved(address indexed agent, uint256 tokenAmount, uint256 bnbAmount, uint256 lp);
    event Swapped(address indexed agent, bool tokenToBnb, uint256 amountIn, uint256 amountOut);

    constructor(address token_, address agent_) {
        if (token_ == address(0) || agent_ == address(0)) revert ZeroAccount();
        token = CensusToken(token_);
        agent = IAgentId(agent_);
    }

    modifier lock() {
        if (_locked == 1) revert Reentrancy();
        _locked = 1;
        _;
        _locked = 0;
    }

    /// @notice BNB wei required to buy one whole token at the current reserves.
    function priceBnbPerToken() external view returns (uint256) {
        if (tokenReserve == 0) return 0;
        return bnbReserve * 1e18 / tokenReserve;
    }

    function quoteSwap(bool tokenToBnb, uint256 amountIn) external view returns (uint256) {
        if (amountIn == 0) revert ZeroAmount();
        if (tokenReserve == 0 || bnbReserve == 0) revert NoLiquidity();
        if (tokenToBnb) return _amountOut(amountIn, tokenReserve, bnbReserve);
        return _amountOut(amountIn, bnbReserve, tokenReserve);
    }

    function addLiquidity(uint256 tokenAmount, uint256 minLpOut) external payable lock returns (uint256 lpOut) {
        AgentGate.check(agent, msg.sender);
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

    function removeLiquidity(uint256 lpAmount, uint256 minTokenOut, uint256 minBnbOut)
        external
        lock
        returns (uint256 tokenOut, uint256 bnbOut)
    {
        AgentGate.check(agent, msg.sender);
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

    /// @param tokenToBnb True to sell tokens for BNB. False to buy tokens with BNB,
    /// in which case `msg.value` must equal `amountIn`.
    function swap(bool tokenToBnb, uint256 amountIn, uint256 minAmountOut)
        external
        payable
        lock
        returns (uint256 amountOut)
    {
        AgentGate.check(agent, msg.sender);
        if (amountIn == 0) revert ZeroAmount();
        if (tokenReserve == 0 || bnbReserve == 0) revert NoLiquidity();

        if (tokenToBnb) {
            if (msg.value != 0) revert ValueMismatch();
            _pullTokens(amountIn);
            amountOut = _amountOut(amountIn, tokenReserve, bnbReserve);
            if (amountOut == 0 || amountOut < minAmountOut || amountOut >= bnbReserve) revert Slippage();
            tokenReserve += amountIn;
            bnbReserve -= amountOut;
            _send(msg.sender, amountOut);
        } else {
            if (msg.value != amountIn) revert ValueMismatch();
            amountOut = _amountOut(amountIn, bnbReserve, tokenReserve);
            if (amountOut == 0 || amountOut < minAmountOut || amountOut >= tokenReserve) revert Slippage();
            bnbReserve += amountIn;
            tokenReserve -= amountOut;
            token.transfer(msg.sender, amountOut);
        }
        emit Swapped(msg.sender, tokenToBnb, amountIn, amountOut);
    }

    function _pullTokens(uint256 amount) internal {
        uint256 beforeBal = token.balanceOf(address(this));
        token.transferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBal != amount) revert MathOverflow();
    }

    function _amountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        uint256 inWithFee = amountIn * FEE_NUMERATOR;
        return reserveOut * inWithFee / (reserveIn * FEE_DENOMINATOR + inWithFee);
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
