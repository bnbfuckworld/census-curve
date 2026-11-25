// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CensusFactoryBase} from "../../src/CensusFactoryBase.sol";

/// @notice Test-only factory. It injects a mock registry and test economics.
/// Do not deploy this contract. Production bytecode is CensusCurveFactory.
contract CensusCurveFactoryHarness is CensusFactoryBase {
    address public immutable agent;
    uint256 public immutable slope;
    uint256 public immutable quota0;
    uint256 public immutable base;
    uint256 public constant SCALE = 100;

    constructor(address agent_, uint256 slope_, uint256 quota0_, uint256 base_) {
        agent = agent_;
        slope = slope_;
        quota0 = quota0_;
        base = base_;
    }

    function create(string calldata name, string calldata symbol)
        external
        returns (address token, address curve, address pool)
    {
        return _create(agent, slope, quota0, base, name, symbol);
    }
}
