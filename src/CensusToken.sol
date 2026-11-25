// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AgentGate} from "./AgentGate.sol";
import {
    AlreadyWired,
    InsufficientBalance,
    OnlyCurve,
    OnlyFactory,
    Reentrancy,
    WrongMarket,
    ZeroAccount,
    ZeroAmount
} from "./Errors.sol";
import {IAgentId} from "./IAgentId.sol";

interface IWiredMarket {
    function token() external view returns (address);
}

/// @notice ERC-20 whose user transfers require an Agent ID on both sides.
/// The pool written by {wire} is the only exemption, and it can be set once.
contract CensusToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    IAgentId public immutable agent;
    address public immutable factory;
    address public curve;
    address public pool;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    uint256 private _locked;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    constructor(string memory name_, string memory symbol_, address agent_, address factory_) {
        if (agent_ == address(0) || factory_ == address(0)) revert ZeroAccount();
        name = name_;
        symbol = symbol_;
        agent = IAgentId(agent_);
        factory = factory_;
    }

    modifier lock() {
        if (_locked == 1) revert Reentrancy();
        _locked = 1;
        _;
        _locked = 0;
    }

    /// @notice Called by the factory in the creation transaction. Cannot be repeated.
    function wire(address curve_, address pool_) external lock {
        if (msg.sender != factory) revert OnlyFactory();
        if (curve != address(0) || pool != address(0)) revert AlreadyWired();
        if (curve_ == address(0) || pool_ == address(0)) revert ZeroAccount();
        if (IWiredMarket(curve_).token() != address(this)) revert WrongMarket();
        if (IWiredMarket(pool_).token() != address(this)) revert WrongMarket();
        curve = curve_;
        pool = pool_;
    }

    function approve(address spender, uint256 amount) external lock returns (bool) {
        if (spender == address(0)) revert ZeroAccount();
        AgentGate.check(agent, msg.sender);
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external lock returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external lock returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientBalance();
            allowance[from][msg.sender] = allowed - amount;
        }
        _move(from, to, amount);
        return true;
    }

    /// @notice Curve-only mint. `to` must be an agent, unless it is the pool.
    function mint(address to, uint256 amount) external lock {
        if (msg.sender != curve) revert OnlyCurve();
        if (to == address(0)) revert ZeroAccount();
        if (amount == 0) revert ZeroAmount();
        if (to != pool) AgentGate.check(agent, to);
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    /// @notice Curve-only burn. Does not query the registry for the zero address.
    function burn(address from, uint256 amount) external lock {
        if (msg.sender != curve) revert OnlyCurve();
        if (from == address(0)) revert ZeroAccount();
        if (amount == 0) revert ZeroAmount();
        if (from != pool) AgentGate.check(agent, from);
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance();
        balanceOf[from] = bal - amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    function _move(address from, address to, uint256 amount) internal {
        if (from == address(0) || to == address(0)) revert ZeroAccount();
        if (from != pool) AgentGate.check(agent, from);
        if (to != pool) AgentGate.check(agent, to);
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance();
        balanceOf[from] = bal - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
