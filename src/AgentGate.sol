// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EmptyHandle, NotAgent, ZeroAccount} from "./Errors.sol";
import {IAgentId} from "./IAgentId.sol";

/// @notice Fail closed unless `account` holds an Agent ID right now.
/// A zero address reverts before any registry call.
library AgentGate {
    function check(IAgentId agent, address account) internal {
        if (account == address(0)) revert ZeroAccount();
        if (agent.balanceOf(account) == 0) revert NotAgent();
        if (bytes(agent.handleOf(account)).length == 0) revert EmptyHandle();
    }
}
