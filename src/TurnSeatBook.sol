// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AgentGate} from "./AgentGate.sol";
import {CensusToken} from "./CensusToken.sol";
import {CurveMath} from "./CurveMath.sol";
import {
    BookFull,
    Guarded,
    Insolvent,
    InsufficientPayment,
    NotOwner,
    Reentrancy,
    TransferFailed,
    WholeTokenOnly,
    WindowTaken,
    ZeroAccount,
    ZeroAmount,
    AlreadySeated
} from "./Errors.sol";
import {IAgentId} from "./IAgentId.sol";
import {ISeatAgent} from "./ISeatAgent.sol";

/// @notice 第二册曲线。每 160 块一个窗口，只成交一个 Agent ID。
/// 窗口第 0 块的价格是 2 倍地板，第 159 块等于地板。空窗口不消耗席位。
/// 每个 tokenId 整册只能入席一次，每次只铸 1 整枚。高出曲线积分的部分打进死地址。
/// 节拍只用 block.number。没有 owner，没有暂停，没有改参，没有提款。
contract TurnSeatBook {
    uint256 public constant WAD = 1e18;
    uint256 public constant BASE = 1e15;
    uint256 public constant SLOPE = 1e15;
    uint256 public constant WINDOW_BLOCKS = 160;
    uint256 public constant GUARD_BLOCKS = 16;
    uint256 public constant CAP = 100;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    struct Seat {
        uint256 agentId;
        address taker;
        bool filled;
    }

    struct Row {
        uint256 agentId;
        address taker;
        uint256 window;
        uint256 price;
        uint256 floorPaid;
        uint256 atBlock;
    }

    struct WindowQuote {
        bool open;
        bool windowFree;
        bool bookFull;
        uint256 window;
        uint256 elapsed;
        uint256 blocksLeft;
        uint256 floor;
        uint256 price;
        uint256 premium;
        uint256 reserveIn;
        uint256 burn;
    }

    CensusToken public immutable token;
    ISeatAgent public immutable agent;
    uint256 public immutable openBlock;

    uint256 public supply;
    uint256 public reserve;
    uint256 public filled;
    mapping(uint256 window => Seat) public seats;
    mapping(uint256 agentId => bool) public idUsed;
    Row[] public roster;

    uint256 private _locked;

    event SeatTaken(
        uint256 indexed window,
        uint256 indexed agentId,
        address indexed taker,
        uint256 price,
        uint256 floorPaid,
        uint256 reserveAdded,
        uint256 burned
    );
    event Sold(address indexed seller, uint256 amount, uint256 refund);

    modifier lock() {
        if (_locked == 1) revert Reentrancy();
        _locked = 1;
        _;
        _locked = 0;
    }

    constructor(address token_, address agent_) {
        if (token_ == address(0) || agent_ == address(0)) revert ZeroAccount();
        token = CensusToken(token_);
        agent = ISeatAgent(agent_);
        openBlock = block.number;
    }

    function rosterLength() external view returns (uint256) {
        return roster.length;
    }

    /// @notice 保护期结束前 open 为 false。之后 window 从 0 递增。空窗不推进 filled。
    function clock(uint256 blockNumber) public view returns (bool open, uint256 window, uint256 elapsed) {
        if (blockNumber < openBlock + GUARD_BLOCKS) return (false, 0, 0);
        uint256 delta = blockNumber - openBlock - GUARD_BLOCKS;
        open = true;
        window = delta / WINDOW_BLOCKS;
        elapsed = delta % WINDOW_BLOCKS;
    }

    /// @notice 第 filledSeats 席（从 0 计）的地板，等于那一整枚在「供给恰好是 filledSeats 枚」时的曲线积分。
    function floorPrice(uint256 filledSeats) public pure returns (uint256) {
        return BASE + (SLOPE / 2) + SLOPE * filledSeats;
    }

    /// @notice 窗口第 0 块为 2 倍地板，第 159 块为地板。elapsed 超过 159 时按 159 算。
    function dutchPrice(uint256 floor, uint256 elapsed) public pure returns (uint256) {
        uint256 span = WINDOW_BLOCKS - 1;
        if (elapsed > span) elapsed = span;
        return floor * (span + (span - elapsed)) / span;
    }

    function quoteWindow(uint256 blockNumber) external view returns (WindowQuote memory q) {
        q.bookFull = filled >= CAP;
        (q.open, q.window, q.elapsed) = clock(blockNumber);
        if (!q.open) {
            q.blocksLeft = openBlock + GUARD_BLOCKS - blockNumber;
        } else {
            q.blocksLeft = WINDOW_BLOCKS - q.elapsed;
            q.windowFree = !seats[q.window].filled && !q.bookFull;
        }
        if (q.bookFull) return q;
        q.floor = floorPrice(filled);
        uint256 elapsedForPrice = q.open ? q.elapsed : 0;
        q.price = dutchPrice(q.floor, elapsedForPrice);
        q.premium = q.price - q.floor;
        q.reserveIn = CurveMath.span(SLOPE, BASE, supply, supply + WAD);
        q.burn = q.price - q.reserveIn;
    }

    function currentSeatPrice() external view returns (uint256) {
        WindowQuote memory q = this.quoteWindow(block.number);
        if (!q.open || !q.windowFree) return 0;
        return q.price;
    }

    function quoteSell(uint256 amount) external view returns (uint256) {
        if (amount == 0) revert ZeroAmount();
        if (amount < WAD || amount % WAD != 0) revert WholeTokenOnly();
        if (amount > supply) revert ZeroAmount();
        uint256 refund = CurveMath.span(SLOPE, BASE, supply - amount, supply);
        if (refund == 0) revert WholeTokenOnly();
        return refund;
    }

    function isCurrentSeat(uint256 agentId, address account) external view returns (bool) {
        (bool open, uint256 window,) = clock(block.number);
        if (!open) return false;
        Seat memory seat = seats[window];
        return seat.filled && seat.agentId == agentId && seat.taker == account;
    }

    function takeSeat(uint256 agentId) external payable lock returns (uint256 price) {
        AgentGate.check(IAgentId(address(agent)), msg.sender);
        if (agent.ownerOf(agentId) != msg.sender) revert NotOwner();
        if (idUsed[agentId]) revert AlreadySeated();
        if (filled >= CAP) revert BookFull();

        (bool open, uint256 window, uint256 elapsed) = clock(block.number);
        if (!open) revert Guarded();
        if (seats[window].filled) revert WindowTaken();

        uint256 layer = CurveMath.span(SLOPE, BASE, supply, supply + WAD);
        uint256 floor = floorPrice(filled);
        if (layer == 0 || floor < layer) revert Insolvent();
        price = dutchPrice(floor, elapsed);
        if (price < floor) revert Insolvent();
        if (msg.value < price) revert InsufficientPayment();
        uint256 burnAmt = price - layer;

        idUsed[agentId] = true;
        seats[window] = Seat({agentId: agentId, taker: msg.sender, filled: true});
        filled += 1;
        supply += WAD;
        reserve += layer;
        roster.push(
            Row({
                agentId: agentId,
                taker: msg.sender,
                window: window,
                price: price,
                floorPaid: floor,
                atBlock: block.number
            })
        );
        token.mint(msg.sender, WAD);
        _solvent();

        emit SeatTaken(window, agentId, msg.sender, price, floor, layer, burnAmt);
        if (burnAmt != 0) _send(DEAD, burnAmt);
        uint256 change = msg.value - price;
        if (change != 0) _send(msg.sender, change);
        _solvent();
    }

    /// @notice 卖回至少 1 整枚，且必须是整枚。退的是当前供给的顶层积分，不退溢价，也不把席位让出来。
    function sell(uint256 amount) external lock {
        AgentGate.check(IAgentId(address(agent)), msg.sender);
        if (amount == 0) revert ZeroAmount();
        if (amount < WAD || amount % WAD != 0) revert WholeTokenOnly();
        if (amount > supply) revert ZeroAmount();
        uint256 refund = CurveMath.span(SLOPE, BASE, supply - amount, supply);
        if (refund == 0 || refund > reserve) revert Insolvent();
        supply -= amount;
        reserve -= refund;
        token.burn(msg.sender, amount);
        _solvent();
        _send(msg.sender, refund);
    }

    function _solvent() internal view {
        if (reserve != CurveMath.target(SLOPE, BASE, supply)) revert Insolvent();
        if (token.totalSupply() != supply) revert Insolvent();
        if (address(this).balance < reserve) revert Insolvent();
        if (supply > filled * WAD) revert Insolvent();
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
