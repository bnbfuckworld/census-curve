// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Guarded, NotAgent} from "../src/Errors.sol";
import {ISeatAgent} from "../src/ISeatAgent.sol";
import {CensusToken} from "../src/CensusToken.sol";
import {TurnSeatBook} from "../src/TurnSeatBook.sol";
import {TurnSeatFactory} from "../src/TurnSeatFactory.sol";
import {TurnSeatPool} from "../src/TurnSeatPool.sol";

/// @notice Reads the live Agent ID registry on a BSC mainnet fork.
/// Does not broadcast and does not use a private key.
contract TurnSeatForkTest is Test {
    address internal constant REGISTRY = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;
    address internal constant HOLDER = 0x8c3b6ED81CD80E9FB617e40B146709fb5d978309;
    address internal constant NONE = 0x1E483aa1351B8C77a0328f34D949f0B396BBc883;

    TurnSeatFactory internal factory;
    CensusToken internal token;
    TurnSeatBook internal book;
    TurnSeatPool internal pool;
    uint256 internal id;

    function setUp() public {
        vm.createSelectFork("bsc");
        id = uint256(keccak256("imrich"));
        assertEq(ISeatAgent(REGISTRY).ownerOf(id), HOLDER);
        vm.deal(HOLDER, 10 ether);
        vm.deal(NONE, 10 ether);
        factory = new TurnSeatFactory();
        vm.prank(HOLDER);
        (address t, address b, address p) = factory.create(unicode"配额曲线第二册", "QTB");
        token = CensusToken(t);
        book = TurnSeatBook(b);
        pool = TurnSeatPool(p);
    }

    function test_holderCanSitAndStrangerCannot() public {
        vm.prank(NONE);
        vm.expectRevert(NotAgent.selector);
        book.takeSeat{value: 1 ether}(id);

        vm.prank(HOLDER);
        vm.expectRevert(Guarded.selector);
        book.takeSeat{value: 1 ether}(id);

        vm.roll(block.number + book.GUARD_BLOCKS());
        uint256 price = book.currentSeatPrice();
        assertGt(price, 0);
        vm.prank(HOLDER);
        book.takeSeat{value: price}(id);
        assertEq(token.balanceOf(HOLDER), 1 ether);
        assertTrue(book.idUsed(id));
        assertEq(book.rosterLength(), 1);

        vm.prank(NONE);
        vm.expectRevert(NotAgent.selector);
        book.takeSeat{value: 1 ether}(id);
    }
}
