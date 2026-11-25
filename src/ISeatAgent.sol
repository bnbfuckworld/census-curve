// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAgentId} from "./IAgentId.sol";

/// @notice Agent ID registry reads used by the second book.
/// `ownerOf` is not `view` in this interface so a test double can count calls.
/// The production registry still answers a normal CALL.
interface ISeatAgent is IAgentId {
    function ownerOf(uint256 tokenId) external returns (address);
}
