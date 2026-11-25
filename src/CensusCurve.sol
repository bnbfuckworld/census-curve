// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AgentGate} from "./AgentGate.sol";
import {CurveMath} from "./CurveMath.sol";
import {CensusToken} from "./CensusToken.sol";
import {MulDiv} from "./MulDiv.sol";
import {
    BadConfig,
    Insolvent,
    InsufficientPayment,
    PrimaryClosed,
    QuotaExceeded,
    Reentrancy,
    TransferFailed,
    ZeroAccount,
    ZeroAmount
} from "./Errors.sol";
import {IAgentId} from "./IAgentId.sol";

/// @notice Per-agent mint quota and the bonding-curve reserve.
/// Selling or trading in the pool does not restore quota.
contract CensusCurve {
    uint256 public constant SCALE = 100;

    CensusToken public immutable token;
    IAgentId public immutable agent;
    uint256 public immutable slope;
    uint256 public immutable quota0;
    uint256 public immutable base;

    uint256 public supply;
    uint256 public reserve;
    uint256 public n;

    mapping(address => bool) public started;
    mapping(address => uint256) public quotaOf;
    mapping(address => uint256) public mintedOf;

    uint256 private _locked;

    event Minted(address indexed agent, uint256 amount, uint256 cost, uint256 quota, uint256 n);
    event Sold(address indexed agent, uint256 amount, uint256 refund);

    constructor(address token_, address agent_, uint256 slope_, uint256 quota0_, uint256 base_) {
        if (token_ == address(0) || agent_ == address(0)) revert ZeroAccount();
        if (slope_ == 0 || quota0_ == 0 || base_ == 0) revert BadConfig();
        token = CensusToken(token_);
        agent = IAgentId(agent_);
        slope = slope_;
        quota0 = quota0_;
        base = base_;
    }

    modifier lock() {
        if (_locked == 1) revert Reentrancy();
        _locked = 1;
        _;
        _locked = 0;
    }

    /// @notice Wei of BNB per whole token at the current supply: slope * U + base.
    function marginalPrice() external view returns (uint256) {
        return MulDiv.mulDiv(slope, supply, CurveMath.WAD) + base;
    }

    function quoteMint(uint256 amount) external view returns (uint256) {
        if (amount == 0) revert ZeroAmount();
        return CurveMath.span(slope, base, supply, supply + amount);
    }

    function quoteSell(uint256 amount) external view returns (uint256) {
        if (amount == 0 || amount > supply) revert ZeroAmount();
        return CurveMath.span(slope, base, supply - amount, supply);
    }

    /// @notice Quota a first mint would lock right now. Zero means primary issuance is closed.
    function nextQuota() external view returns (uint256) {
        return quota0 * SCALE / (SCALE + n);
    }

    function remaining(address account) external view returns (uint256) {
        if (!started[account]) return quota0 * SCALE / (SCALE + n);
        uint256 used = mintedOf[account];
        uint256 cap = quotaOf[account];
        return used >= cap ? 0 : cap - used;
    }

    function mint(uint256 amount) external payable lock {
        AgentGate.check(agent, msg.sender);
        if (amount == 0) revert ZeroAmount();

        uint256 cap;
        uint256 cohort = n;
        if (!started[msg.sender]) {
            cap = quota0 * SCALE / (SCALE + cohort);
            if (cap < 1) revert PrimaryClosed();
            if (amount > cap) revert QuotaExceeded();
            started[msg.sender] = true;
            quotaOf[msg.sender] = cap;
            cohort = n + 1;
        } else {
            cap = quotaOf[msg.sender];
            if (mintedOf[msg.sender] + amount > cap) revert QuotaExceeded();
        }

        uint256 pay = CurveMath.span(slope, base, supply, supply + amount);
        if (msg.value < pay) revert InsufficientPayment();

        supply += amount;
        reserve += pay;
        mintedOf[msg.sender] += amount;
        n = cohort;
        token.mint(msg.sender, amount);
        _solvency();

        uint256 change = msg.value - pay;
        if (change != 0) _send(msg.sender, change);
        emit Minted(msg.sender, amount, pay, cap, n);
    }

    function sell(uint256 amount) external lock {
        AgentGate.check(agent, msg.sender);
        if (amount == 0 || amount > supply) revert ZeroAmount();

        uint256 refund = CurveMath.span(slope, base, supply - amount, supply);
        if (refund > reserve) revert Insolvent();

        supply -= amount;
        reserve -= refund;
        token.burn(msg.sender, amount);
        _solvency();
        if (refund != 0) _send(msg.sender, refund);
        emit Sold(msg.sender, amount, refund);
    }

    function _solvency() internal view {
        if (reserve != CurveMath.target(slope, base, supply)) revert Insolvent();
        if (token.totalSupply() != supply) revert Insolvent();
        if (address(this).balance < reserve) revert Insolvent();
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
