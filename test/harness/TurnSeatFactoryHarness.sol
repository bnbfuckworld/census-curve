// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TurnSeatFactoryBase} from "../../src/TurnSeatFactoryBase.sol";

/// @notice Test-only factory. It injects a mock registry.
/// Do not deploy this contract. Production bytecode is TurnSeatFactory.
contract TurnSeatFactoryHarness is TurnSeatFactoryBase {
    address public immutable agent;

    constructor(address agent_) {
        agent = agent_;
    }

    function create(string calldata name, string calldata symbol)
        external
        returns (address token, address book, address pool)
    {
        return _create(agent, name, symbol);
    }
}
