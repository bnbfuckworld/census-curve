// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AgentGate} from "./AgentGate.sol";
import {CensusCurve} from "./CensusCurve.sol";
import {CensusPool} from "./CensusPool.sol";
import {CensusToken} from "./CensusToken.sol";
import {BadName, BadSymbol} from "./Errors.sol";
import {IAgentId} from "./IAgentId.sol";

/// @notice Shared creation path. Economic numbers are arguments so the test
/// harness can inject them; the production factory passes only its constants.
abstract contract CensusFactoryBase {
    struct Market {
        address token;
        address curve;
        address pool;
    }

    Market[] public markets;

    event MarketCreated(
        address indexed creator, address token, address curve, address pool, string name, string symbol
    );

    function marketCount() external view returns (uint256) {
        return markets.length;
    }

    function _create(
        address agent,
        uint256 slope,
        uint256 quota0,
        uint256 base,
        string calldata name,
        string calldata symbol
    ) internal returns (address token, address curve, address pool) {
        AgentGate.check(IAgentId(agent), msg.sender);
        if (bytes(name).length == 0 || bytes(name).length > 32) revert BadName();
        if (bytes(symbol).length == 0 || bytes(symbol).length > 8) revert BadSymbol();

        CensusToken t = new CensusToken(name, symbol, agent, address(this));
        CensusCurve c = new CensusCurve(address(t), agent, slope, quota0, base);
        CensusPool p = new CensusPool(address(t), agent);
        t.wire(address(c), address(p));

        token = address(t);
        curve = address(c);
        pool = address(p);
        markets.push(Market({token: token, curve: curve, pool: pool}));
        emit MarketCreated(msg.sender, token, curve, pool, name, symbol);
    }
}
