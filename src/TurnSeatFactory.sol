// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TurnSeatFactoryBase} from "./TurnSeatFactoryBase.sol";
import {WrongChain} from "./Errors.sol";

/// @notice 第二册工厂。链号、注册表和窗口长度都写死。
/// 没有 owner，没有暂停，没有改参，也没有把资金提出去的函数。
contract TurnSeatFactory is TurnSeatFactoryBase {
    /// @dev SPACE ID Agent ID on BNB Smart Chain.
    address public constant AGENT = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;

    constructor() {
        if (block.chainid != 56) revert WrongChain();
    }

    function create(string calldata name, string calldata symbol)
        external
        returns (address token, address book, address pool)
    {
        return _create(AGENT, name, symbol);
    }
}
