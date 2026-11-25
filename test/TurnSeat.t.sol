// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {
    AlreadySeated,
    BookFull,
    Guarded,
    NotAgent,
    NotOwner,
    OnlyCurve,
    OnlyPool,
    WholeTokenOnly,
    WindowTaken,
    WrongChain,
    ZeroAmount
} from "../src/Errors.sol";
import {TurnSeatBook} from "../src/TurnSeatBook.sol";
import {TurnSeatFactory} from "../src/TurnSeatFactory.sol";
import {TurnSeatPool} from "../src/TurnSeatPool.sol";
import {CensusToken} from "../src/CensusToken.sol";
import {MockSeatRegistry} from "./harness/MockSeatRegistry.sol";
import {TurnSeatFactoryHarness} from "./harness/TurnSeatFactoryHarness.sol";

contract SeatWallet {
    receive() external payable {}

    function take(TurnSeatBook book, uint256 id) external payable {
        book.takeSeat{value: msg.value}(id);
    }
}

contract ReenteringSeat {
    TurnSeatBook public book;
    uint256 public id;
    bool public armed;
    uint256 public innerTries;

    constructor(TurnSeatBook book_) {
        book = book_;
    }

    receive() external payable {
        if (!armed) return;
        armed = false;
        innerTries += 1;
        try book.takeSeat{value: address(this).balance}(id) {} catch {}
    }

    function take(uint256 agentId) external payable {
        id = agentId;
        armed = true;
        book.takeSeat{value: msg.value}(agentId);
    }
}

contract TurnSeatTest is Test {
    uint256 internal constant WAD = 1e18;

    MockSeatRegistry internal mock;
    TurnSeatFactoryHarness internal factory;
    CensusToken internal token;
    TurnSeatBook internal book;
    TurnSeatPool internal pool;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        mock = new MockSeatRegistry();
        factory = new TurnSeatFactoryHarness(address(mock));
        mock.setAgent(alice, 1, "alice");
        mock.setAgent(bob, 2, "bob");
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
        vm.prank(alice);
        (address t, address b, address p) = factory.create("Seat", "QTB");
        token = CensusToken(t);
        book = TurnSeatBook(b);
        pool = TurnSeatPool(p);
    }

    function _open() internal {
        vm.roll(book.openBlock() + book.GUARD_BLOCKS());
    }

    function _take(address who, uint256 id) internal returns (uint256 price) {
        price = book.currentSeatPrice();
        vm.prank(who);
        book.takeSeat{value: price}(id);
    }

    function test_floorMatchesBookOneIntegral() public view {
        assertEq(book.floorPrice(0), 1.5e15);
        assertEq(book.floorPrice(1), 2.5e15);
        assertEq(book.floorPrice(99), 100.5e15);
        uint256 sum;
        for (uint256 i = 0; i < 100; i++) {
            sum += book.floorPrice(i);
        }
        assertEq(sum, 5.1 ether);
    }

    function test_clockAndDutchBoundaries() public {
        assertEq(book.openBlock(), block.number);
        (bool open,,) = book.clock(block.number);
        assertFalse(open);

        uint256 floor = book.floorPrice(0);
        uint256 prev = type(uint256).max;
        for (uint256 elapsed = 0; elapsed < 160; elapsed++) {
            uint256 price = book.dutchPrice(floor, elapsed);
            assertGe(price, floor);
            assertLe(price, floor * 2);
            assertLt(price, prev);
            prev = price;
        }
        assertEq(book.dutchPrice(floor, 0), floor * 2);
        assertEq(book.dutchPrice(floor, 159), floor);
        assertEq(book.dutchPrice(floor, 160), floor);

        _open();
        uint256 elapsedNow;
        (open,, elapsedNow) = book.clock(block.number);
        assertTrue(open);
        assertEq(elapsedNow, 0);
        assertEq(book.currentSeatPrice(), floor * 2);

        vm.roll(book.openBlock() + book.GUARD_BLOCKS() + 159);
        assertEq(book.currentSeatPrice(), floor);
        TurnSeatBook.WindowQuote memory atEnd = book.quoteWindow(block.number);
        assertEq(atEnd.blocksLeft, 1);
        assertEq(atEnd.premium, 0);
        assertTrue(atEnd.windowFree);
    }

    function testFuzz_dutchStaysBetweenFloorAndDouble(uint96 floor, uint256 elapsed) public view {
        floor = uint96(bound(floor, 1, type(uint96).max));
        elapsed = bound(elapsed, 0, 400);
        uint256 price = book.dutchPrice(floor, elapsed);
        uint256 earlier = book.dutchPrice(floor, elapsed == 0 ? 0 : elapsed - 1);
        assertGe(price, floor);
        assertLe(price, uint256(floor) * 2);
        assertGe(earlier, price);
    }

    function testFuzz_feeBounds(uint256 prior, bool seatHolder) public view {
        prior = bound(prior, 0, 5000);
        uint256 fee = pool.quoteFee(prior, seatHolder);
        assertGe(fee, 30);
        assertLe(fee, 100);
        if (seatHolder) assertEq(fee, 30);
    }

    function test_guardBlocksRejectTake() public {
        vm.prank(alice);
        vm.expectRevert(Guarded.selector);
        book.takeSeat{value: 1 ether}(1);

        vm.roll(book.openBlock() + 15);
        vm.prank(alice);
        vm.expectRevert(Guarded.selector);
        book.takeSeat{value: 1 ether}(1);

        vm.roll(book.openBlock() + 16);
        uint256 price = book.currentSeatPrice();
        vm.prank(alice);
        book.takeSeat{value: price}(1);
        assertEq(token.balanceOf(alice), WAD);
        assertEq(book.filled(), 1);
    }

    function test_emptyWindowDoesNotConsumeSeat() public {
        uint256 floor = book.floorPrice(0);
        vm.roll(book.openBlock() + book.GUARD_BLOCKS() + book.WINDOW_BLOCKS());
        (bool open, uint256 window, uint256 elapsed) = book.clock(block.number);
        assertTrue(open);
        assertEq(window, 1);
        assertEq(elapsed, 0);
        assertEq(book.filled(), 0);
        assertEq(book.currentSeatPrice(), floor * 2);
        _take(alice, 1);
        assertEq(book.filled(), 1);
        assertEq(book.reserve(), floor);
    }

    function test_oneSeatPerWindowAndOneIdPerBook() public {
        _open();
        _take(alice, 1);
        vm.prank(bob);
        vm.expectRevert(WindowTaken.selector);
        book.takeSeat{value: 1 ether}(2);

        vm.roll(book.openBlock() + book.GUARD_BLOCKS() + book.WINDOW_BLOCKS());
        uint256 nextPrice = book.currentSeatPrice();
        vm.prank(alice);
        vm.expectRevert(AlreadySeated.selector);
        book.takeSeat{value: nextPrice}(1);

        _take(bob, 2);
        assertEq(book.filled(), 2);
        assertEq(token.balanceOf(bob), WAD);
    }

    function test_fakeOwnerAndUnknownId() public {
        _open();
        vm.prank(bob);
        vm.expectRevert(NotOwner.selector);
        book.takeSeat{value: 1 ether}(1);

        vm.prank(alice);
        vm.expectRevert();
        book.takeSeat{value: 1 ether}(99);

        address stranger = address(0x1234);
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        vm.expectRevert(NotAgent.selector);
        book.takeSeat{value: 1 ether}(1);
        assertEq(mock.zeroHits(), 0);
    }

    function test_overpayRefundsAndPremiumBurns() public {
        _open();
        uint256 floor = book.floorPrice(0);
        uint256 price = book.currentSeatPrice();
        assertEq(price, floor * 2);
        uint256 aliceBefore = alice.balance;
        uint256 deadBefore = book.DEAD().balance;
        vm.prank(alice);
        book.takeSeat{value: price + 0.25 ether}(1);
        assertEq(alice.balance, aliceBefore - price);
        assertEq(book.DEAD().balance - deadBefore, price - floor);
        assertEq(book.reserve(), floor);
        assertEq(address(book).balance, book.reserve());
        assertEq(token.totalSupply(), WAD);
    }

    function test_sellReturnsFloorNotPremium() public {
        _open();
        uint256 floor = book.floorPrice(0);
        uint256 price = _take(alice, 1);
        uint256 afterBuy = alice.balance;
        uint256 deadAfter = book.DEAD().balance;
        vm.prank(alice);
        book.sell(WAD);
        assertEq(alice.balance, afterBuy + floor);
        assertEq(book.DEAD().balance, deadAfter);
        assertEq(book.reserve(), 0);
        assertEq(book.filled(), 1);
        assertTrue(book.idUsed(1));
        assertEq(token.balanceOf(alice), 0);
        assertLt(floor, price);
    }

    function test_sellLowerBoundAndNoDustMint() public {
        _open();
        _take(alice, 1);
        vm.prank(alice);
        vm.expectRevert(OnlyCurve.selector);
        token.mint(alice, 1);

        vm.prank(alice);
        vm.expectRevert(WholeTokenOnly.selector);
        book.sell(1);

        vm.prank(alice);
        vm.expectRevert(WholeTokenOnly.selector);
        book.sell(WAD - 1);

        vm.prank(alice);
        vm.expectRevert(WholeTokenOnly.selector);
        book.sell(WAD + 1);

        vm.prank(alice);
        book.sell(WAD);
    }

    function testFuzz_sellRejectsBelowOneToken(uint256 amount) public {
        amount = bound(amount, 1, WAD - 1);
        _open();
        _take(alice, 1);
        vm.prank(alice);
        vm.expectRevert(WholeTokenOnly.selector);
        book.sell(amount);
    }

    function testFuzz_overpayIsRefunded(uint96 extra) public {
        extra = uint96(bound(extra, 1, 50 ether));
        _open();
        uint256 price = book.currentSeatPrice();
        uint256 before = alice.balance;
        vm.prank(alice);
        book.takeSeat{value: price + extra}(1);
        assertEq(alice.balance, before - price);
        assertEq(address(book).balance, book.reserve());
    }

    function test_reserveMatchesIntegralAcrossSeats() public {
        uint256 start = book.openBlock() + book.GUARD_BLOCKS();
        for (uint256 i = 0; i < 3; i++) {
            vm.roll(start + i * book.WINDOW_BLOCKS() + 159);
            address who = i == 0 ? alice : (i == 1 ? bob : address(0xCA201));
            uint256 id = i + 1;
            if (i == 2) {
                mock.setAgent(who, id, "carol");
                vm.deal(who, 10 ether);
            }
            uint256 price = book.currentSeatPrice();
            assertEq(price, book.floorPrice(i));
            vm.prank(who);
            book.takeSeat{value: price}(id);
        }
        assertEq(book.supply(), 3 ether);
        assertEq(book.reserve(), book.floorPrice(0) + book.floorPrice(1) + book.floorPrice(2));
        assertEq(book.rosterLength(), 3);
        (uint256 agentId, address taker, uint256 window,,,) = book.roster(0);
        assertEq(agentId, 1);
        assertEq(taker, alice);
        assertEq(window, 0);
    }

    function test_sellDoesNotReopenTheCheapSeat() public {
        vm.roll(book.openBlock() + book.GUARD_BLOCKS() + 159);
        uint256 first = _take(alice, 1);
        assertEq(first, book.floorPrice(0));
        vm.prank(alice);
        book.sell(WAD);

        vm.roll(book.openBlock() + book.GUARD_BLOCKS() + book.WINDOW_BLOCKS() + 159);
        uint256 deadBefore = book.DEAD().balance;
        uint256 second = _take(bob, 2);
        assertEq(second, book.floorPrice(1));
        assertGt(second, first);
        assertEq(book.reserve(), first);
        assertEq(book.DEAD().balance - deadBefore, second - first);
        assertEq(book.filled(), 2);
    }

    function test_timestampDoesNotMoveTheClock() public {
        _open();
        uint256 price = book.currentSeatPrice();
        vm.warp(block.timestamp + 30 days);
        assertEq(book.currentSeatPrice(), price);
        vm.roll(block.number + 1);
        assertLt(book.currentSeatPrice(), price);
    }

    function test_contractWalletIsMsgSenderNotOrigin() public {
        SeatWallet wallet = new SeatWallet();
        mock.setAgent(address(wallet), 7, "wallet");
        vm.deal(address(wallet), 5 ether);
        _open();
        uint256 price = book.currentSeatPrice();
        vm.prank(alice, alice);
        wallet.take{value: price}(book, 7);
        assertEq(token.balanceOf(address(wallet)), WAD);
        assertEq(book.idUsed(7), true);
    }

    function test_reentrancyOnRefundDoesNotTakeTwoSeats() public {
        ReenteringSeat attacker = new ReenteringSeat(book);
        mock.setAgent(address(attacker), 8, "re");
        vm.deal(address(attacker), 5 ether);
        _open();
        uint256 price = book.currentSeatPrice();
        vm.prank(address(attacker));
        attacker.take{value: price + 1 ether}(8);
        assertEq(book.filled(), 1);
        assertEq(attacker.innerTries(), 1);
        assertEq(token.balanceOf(address(attacker)), WAD);
    }

    function test_feeRisesInsideBlockCapsAndResets() public {
        _open();
        _take(alice, 1);
        vm.startPrank(alice);
        token.approve(address(pool), WAD);
        uint256 lp = pool.addLiquidity{value: 1 ether}(WAD, 0, 1);
        vm.stopPrank();
        assertGt(lp, 0);

        (uint256 fee0, uint256 prior0) = pool.previewFee(bob, 2);
        assertEq(fee0, 30);
        assertEq(prior0, 0);

        vm.prank(bob);
        pool.swap{value: 0.001 ether}(false, 0.001 ether, 0, 2);
        (uint256 fee1, uint256 prior1) = pool.previewFee(bob, 2);
        assertEq(fee1, 35);
        assertEq(prior1, 1);

        for (uint256 i = 1; i < 16; i++) {
            vm.prank(bob);
            pool.swap{value: 0.001 ether}(false, 0.001 ether, 0, 2);
        }
        (uint256 feeCap, uint256 priorCap) = pool.previewFee(bob, 2);
        assertEq(feeCap, 100);
        assertEq(priorCap, 16);
        (uint256 aliceFee, uint256 alicePrior) = pool.previewFee(alice, 1);
        assertEq(aliceFee, 30);
        assertEq(alicePrior, 16);

        uint256 prior = pool.swapsInBlock();
        vm.prank(alice);
        pool.swap{value: 0.001 ether}(false, 0.001 ether, 0, 1);
        assertEq(pool.swapsInBlock(), prior + 1);
        (uint256 aliceFeeAfter, uint256 alicePriorAfter) = pool.previewFee(alice, 1);
        assertEq(aliceFeeAfter, 30);
        assertEq(alicePriorAfter, prior + 1);

        vm.roll(block.number + 1);
        (uint256 feeReset, uint256 priorReset) = pool.previewFee(bob, 2);
        assertEq(feeReset, 30);
        assertEq(priorReset, 0);
    }

    function test_seatHolderSkipsCongestionWhileOthersPayHalf() public view {
        assertEq(pool.quoteFee(0, false), 30);
        assertEq(pool.quoteFee(1, false), 35);
        assertEq(pool.quoteFee(1, true), 30);
        assertEq(pool.quoteFee(14, false), 100);
        assertEq(pool.quoteFee(100, true), 30);
    }

    function test_swapRejectsNonOwnerAndOutsideBeforeSwap() public {
        _open();
        _take(alice, 1);
        vm.startPrank(alice);
        token.approve(address(pool), WAD);
        pool.addLiquidity{value: 1 ether}(WAD, 0, 1);
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert(NotOwner.selector);
        pool.swap{value: 0.001 ether}(false, 0.001 ether, 0, 1);

        vm.prank(bob);
        vm.expectRevert(OnlyPool.selector);
        pool.beforeSwap(bob, 2);
    }

    function test_lpAddAndRemoveByShare() public {
        _open();
        _take(alice, 1);
        vm.roll(block.number + book.WINDOW_BLOCKS());
        _take(bob, 2);

        vm.startPrank(alice);
        token.approve(address(pool), WAD);
        uint256 lpAlice = pool.addLiquidity{value: 1 ether}(WAD, 0, 1);
        vm.stopPrank();
        vm.startPrank(bob);
        token.approve(address(pool), WAD);
        uint256 lpBob = pool.addLiquidity{value: 1 ether}(WAD, 0, 2);
        vm.stopPrank();
        assertGt(lpAlice, 0);
        assertGt(lpBob, 0);

        uint256 half = lpAlice / 2;
        uint256 tokenBefore = pool.tokenReserve();
        uint256 bnbBefore = pool.bnbReserve();
        uint256 supplyBefore = pool.lpSupply();
        vm.prank(alice);
        (uint256 tokenOut, uint256 bnbOut) = pool.removeLiquidity(half, 0, 0, 1);
        assertEq(tokenOut, half * tokenBefore / supplyBefore);
        assertEq(bnbOut, half * bnbBefore / supplyBefore);
        assertEq(pool.lpOf(alice), lpAlice - half);

        uint256 bobToken = token.balanceOf(bob);
        uint256 bobBnb = bob.balance;
        uint256 bobLp = pool.lpOf(bob);
        vm.prank(bob);
        (uint256 bobTokenOut, uint256 bobBnbOut) = pool.removeLiquidity(bobLp, 0, 0, 2);
        assertGt(bobTokenOut, 0);
        assertGt(bobBnbOut, 0);
        assertEq(token.balanceOf(bob), bobToken + bobTokenOut);
        assertEq(bob.balance, bobBnb + bobBnbOut);
        assertEq(pool.lpOf(bob), 0);

        vm.prank(bob);
        vm.expectRevert(ZeroAmount.selector);
        pool.removeLiquidity(1, 0, 0, 2);

        assertEq(pool.lpOf(address(pool)), pool.MINIMUM_LIQUIDITY());
    }

    function test_directBnbAndNoAdmin() public {
        vm.prank(alice);
        (bool ok,) = address(book).call{value: 1}("");
        assertFalse(ok);
        vm.prank(alice);
        (bool poolOk,) = address(pool).call{value: 1}("");
        assertFalse(poolOk);

        (bool ownerOk,) = address(factory).staticcall(abi.encodeWithSignature("owner()"));
        assertFalse(ownerOk);
        (bool pauseOk,) = address(book).staticcall(abi.encodeWithSignature("pause()"));
        assertFalse(pauseOk);
        (bool withdrawOk,) = address(book).staticcall(abi.encodeWithSignature("withdraw()"));
        assertFalse(withdrawOk);
    }

    function test_productionFactoryOnlyOnBsc() public {
        vm.expectRevert(WrongChain.selector);
        new TurnSeatFactory();
        vm.chainId(56);
        TurnSeatFactory live = new TurnSeatFactory();
        assertEq(live.AGENT(), 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F);
    }

    function test_bookFull() public {
        uint256 start = book.openBlock() + book.GUARD_BLOCKS();
        for (uint256 i = 0; i < 100; i++) {
            address who = address(uint160(0x1000 + i));
            mock.setAgent(who, i + 1, "n");
            vm.deal(who, 1 ether);
            vm.roll(start + i * book.WINDOW_BLOCKS());
            uint256 price = book.currentSeatPrice();
            vm.prank(who);
            book.takeSeat{value: price}(i + 1);
        }
        assertEq(book.filled(), 100);
        address extra = address(0xBEEF);
        mock.setAgent(extra, 999, "x");
        vm.deal(extra, 1 ether);
        vm.roll(start + 100 * book.WINDOW_BLOCKS());
        vm.prank(extra);
        vm.expectRevert(BookFull.selector);
        book.takeSeat{value: 1 ether}(999);
    }

}
