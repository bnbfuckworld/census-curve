// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice SPACE ID Agent ID reads. The functions are not marked view so a test
/// double can count calls. The production registry still answers a normal CALL.
interface IAgentId {
    function balanceOf(address account) external returns (uint256);
    function handleOf(address account) external returns (string memory);
}
