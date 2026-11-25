// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CensusFactoryBase} from "./CensusFactoryBase.sol";
import {WrongChain} from "./Errors.sol";

/// @notice Production factory. Chain id, registry, and economics are fixed.
/// There is no owner, no pause, no parameter setter, and no upgrade path.
/// This file is the release bytecode. The test harness is not part of it.
contract CensusCurveFactory is CensusFactoryBase {
    /// @dev SPACE ID Agent ID on BNB Smart Chain.
    address public constant AGENT = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;

    /// @dev Wei of BNB. Marginal price per whole token is `SLOPE * supplyTokens + BASE`.
    /// At 0 supply the price is 0.001 BNB. At 100 tokens it is 0.101 BNB.
    /// The first agent's 100-token quota costs 5.1 BNB along the integral.
    uint256 public constant SLOPE = 1e15;
    uint256 public constant BASE = 1e15;
    uint256 public constant QUOTA0 = 100 ether;
    uint256 public constant SCALE = 100;

    constructor() {
        if (block.chainid != 56) revert WrongChain();
    }

    function create(string calldata name, string calldata symbol)
        external
        returns (address token, address curve, address pool)
    {
        return _create(AGENT, SLOPE, QUOTA0, BASE, name, symbol);
    }
}
