// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AgentGate} from "./AgentGate.sol";
import {CensusToken} from "./CensusToken.sol";
import {BadName, BadSymbol} from "./Errors.sol";
import {IAgentId} from "./IAgentId.sol";
import {TurnSeatBook} from "./TurnSeatBook.sol";
import {TurnSeatPool} from "./TurnSeatPool.sol";

/// @notice Shared creation path for the second book. The production factory
/// passes the fixed registry. The test harness is not release bytecode.
abstract contract TurnSeatFactoryBase {
    struct Market {
        address token;
        address book;
        address pool;
    }

    Market[] public markets;

    event MarketCreated(
        address indexed creator, address token, address book, address pool, string name, string symbol
    );

    function marketCount() external view returns (uint256) {
        return markets.length;
    }

    function _create(address agent, string calldata name, string calldata symbol)
        internal
        returns (address token, address book, address pool)
    {
        AgentGate.check(IAgentId(agent), msg.sender);
        if (bytes(name).length == 0 || bytes(name).length > 32) revert BadName();
        if (bytes(symbol).length == 0 || bytes(symbol).length > 8) revert BadSymbol();

        CensusToken t = new CensusToken(name, symbol, agent, address(this));
        TurnSeatBook b = new TurnSeatBook(address(t), agent);
        TurnSeatPool p = new TurnSeatPool(address(t), agent, address(b));
        t.wire(address(b), address(p));

        token = address(t);
        book = address(b);
        pool = address(p);
        markets.push(Market({token: token, book: book, pool: pool}));
        emit MarketCreated(msg.sender, token, book, pool, name, symbol);
    }
}
