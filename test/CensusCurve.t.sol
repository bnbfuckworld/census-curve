// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CurveMath} from "../src/CurveMath.sol";
import {MulDiv} from "../src/MulDiv.sol";
import {CensusCurve} from "../src/CensusCurve.sol";
import {CensusCurveFactory} from "../src/CensusCurveFactory.sol";
import {CensusPool} from "../src/CensusPool.sol";
import {CensusToken} from "../src/CensusToken.sol";
import {
    AlreadyWired,
    BadName,
    EmptyHandle,
    NotAgent,
    PrimaryClosed,
    QuotaExceeded,
    WrongChain,
    ZeroAccount
} from "../src/Errors.sol";
import {MockAgentId} from "./harness/MockAgentId.sol";
import {CensusCurveFactoryHarness} from "./harness/CensusCurveFactoryHarness.sol";

interface Vm {
    function prank(address msgSender) external;
    function prank(address msgSender, address txOrigin) external;
    function deal(address account, uint256 newBalance) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert() external;
    function chainId(uint256 newChainId) external;
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function expectCall(address callee, bytes calldata data, uint64 count) external;
}

contract CurveProbe {
    function target(uint256 slope, uint256 base, uint256 s) external pure returns (uint256) {
        return CurveMath.target(slope, base, s);
    }

    function mul(uint256 a, uint256 b, uint256 d) external pure returns (uint256) {
        return MulDiv.mulDiv(a, b, d);
    }
}

contract Forwarder {
    function mint(CensusCurve curve, uint256 amount) external payable {
        curve.mint{value: msg.value}(amount);
    }
}

contract AgentSink {
    receive() external payable {}

    function mint(CensusCurve curve, uint256 amount) external payable {
        curve.mint{value: msg.value}(amount);
    }

    function sell(CensusCurve curve, uint256 amount) external {
        curve.sell(amount);
    }
}

contract ReenteringAgent {
    CensusCurve public curve;
    uint256 public chunk;
    bool public armed;

    constructor(CensusCurve curve_) {
        curve = curve_;
    }

    function mint(uint256 amount) external payable {
        curve.mint{value: msg.value}(amount);
    }

    function sell(uint256 amount) external {
        chunk = amount;
        armed = true;
        curve.sell(amount);
    }

    receive() external payable {
        if (!armed) return;
        armed = false;
        try curve.sell(chunk) {} catch {}
    }
}

contract CensusCurveTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant SLOPE = 2e18;
    uint256 internal constant BASE = 1e18;
    uint256 internal constant QUOTA0 = 10 ether;

    MockAgentId internal mock;
    CensusCurveFactoryHarness internal factory;
    CensusToken internal token;
    CensusCurve internal curve;
    CensusPool internal pool;
    CurveProbe internal probe;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA201);

    function setUp() public {
        mock = new MockAgentId();
        probe = new CurveProbe();
        factory = new CensusCurveFactoryHarness(address(mock), SLOPE, QUOTA0, BASE);
        mock.setAgent(alice, 1, "alice");
        mock.setAgent(bob, 1, "bob");
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
        vm.prank(alice);
        (address t, address c, address p) = factory.create("Quota", "QTA");
        token = CensusToken(t);
        curve = CensusCurve(c);
        pool = CensusPool(p);
    }

    function test_costMatchesWholeTokenSpec() public view {
        // From 0 to 3 tokens: slope * 9 / 2 + base * 3 = 9 + 3 = 12 BNB with these constants.
        require(probe.target(SLOPE, BASE, 3 ether) == 12 ether, "0 to 3");
        // Segment 1 -> 3 equals the spec: slope * (9 - 1) / 2 + base * 2 = 10 BNB.
        uint256 segment = probe.target(SLOPE, BASE, 3 ether) - probe.target(SLOPE, BASE, 1 ether);
        require(segment == 10 ether, "1 to 3");
        require(probe.target(SLOPE, BASE, 1 ether) == 2 ether, "first token");
    }

    function test_mulDivFitsOverflowingProduct() public view {
        require(probe.mul(type(uint256).max, 2, 2) == type(uint256).max, "max");
        require(probe.mul(10, 10, 3) == 33, "floor");
    }

    function test_mulDivRevertsWhenResultOverflows() public {
        vm.expectRevert();
        probe.mul(type(uint256).max, type(uint256).max, 1);
    }

    function test_mintSellSwapTransferRevertWithoutAgent() public {
        mock.setBalance(carol, 0);
        vm.deal(carol, 10 ether);
        uint256 cost = curve.quoteMint(1 ether);

        vm.expectRevert(abi.encodeWithSelector(NotAgent.selector));
        vm.prank(carol);
        curve.mint{value: cost}(1 ether);

        _mint(alice, 1 ether);

        vm.expectRevert(abi.encodeWithSelector(NotAgent.selector));
        vm.prank(carol);
        curve.sell(1);

        vm.expectRevert(abi.encodeWithSelector(NotAgent.selector));
        vm.prank(carol);
        pool.swap{value: 1 ether}(false, 1 ether, 0);

        vm.expectRevert(abi.encodeWithSelector(NotAgent.selector));
        vm.prank(alice);
        token.transfer(carol, 1);
    }

    function test_zeroAddressNeverReachesBalanceOf() public {
        _mint(alice, 1 ether);
        uint256 hits = mock.zeroHits();

        vm.expectCall(address(mock), abi.encodeWithSelector(MockAgentId.balanceOf.selector, address(0)), 0);

        vm.expectRevert(abi.encodeWithSelector(ZeroAccount.selector));
        vm.prank(alice);
        token.transfer(address(0), 1);

        vm.expectRevert(abi.encodeWithSelector(ZeroAccount.selector));
        vm.prank(alice);
        token.approve(address(0), 1);

        vm.prank(alice);
        curve.sell(1 ether);

        require(mock.zeroHits() == hits, "zero counter");
        uint256 n = mock.seenCount();
        for (uint256 i; i < n; i++) {
            require(mock.seen(i) != address(0), "seen zero");
        }
    }

    function test_expectCallSeesRevertedQuery() public {
        // A reverted frame still counts. This pins the cheatcode the zero-address test relies on.
        vm.expectCall(address(mock), abi.encodeWithSelector(MockAgentId.balanceOf.selector, alice), 1);
        vm.expectRevert(abi.encodeWithSelector(QuotaExceeded.selector));
        vm.prank(alice);
        curve.mint{value: 1 ether}(QUOTA0 + 1);
    }

    function test_emptyHandleReverts() public {
        mock.setAgent(carol, 1, "");
        vm.deal(carol, 10 ether);
        vm.expectRevert(abi.encodeWithSelector(EmptyHandle.selector));
        vm.prank(carol);
        curve.mint{value: 1 ether}(1 ether);
    }

    function test_registryRevertBubbles() public {
        mock.setRevert(true);
        vm.expectRevert(abi.encodeWithSelector(MockAgentId.RegistryDown.selector));
        vm.prank(alice);
        curve.mint{value: 1 ether}(1 ether);
    }

    function test_sellDoesNotRestoreQuota() public {
        _mint(alice, QUOTA0);
        require(curve.mintedOf(alice) == QUOTA0, "filled");
        uint256 cohort = curve.n();
        vm.prank(alice);
        curve.sell(QUOTA0);
        require(curve.mintedOf(alice) == QUOTA0, "minted stays");
        require(curve.quotaOf(alice) == QUOTA0, "quota stays");
        require(curve.n() == cohort, "n stays");
        require(token.balanceOf(alice) == 0, "tokens burned");
        vm.expectRevert(abi.encodeWithSelector(QuotaExceeded.selector));
        vm.prank(alice);
        curve.mint{value: 1 ether}(1);
    }

    function test_secondQuotaIsSmaller() public {
        _mint(alice, 1);
        _mint(bob, 1);
        uint256 first = QUOTA0 * 100 / 100;
        uint256 second = QUOTA0 * 100 / 101;
        require(second < first, "order");
        require(curve.quotaOf(alice) == first, "alice");
        require(curve.quotaOf(bob) == second, "bob");
        require(curve.n() == 2, "cohort");
    }

    function test_primaryStopsBelowOneUnit() public {
        CensusCurveFactoryHarness tiny = new CensusCurveFactoryHarness(address(mock), SLOPE, 1, BASE);
        vm.prank(alice);
        (address t, address c,) = tiny.create("Tiny", "T");
        CensusToken tinyToken = CensusToken(t);
        CensusCurve tinyCurve = CensusCurve(c);
        vm.prank(alice);
        tinyCurve.mint{value: 1 ether}(1);
        require(tinyCurve.quotaOf(alice) == 1, "unit");
        require(tinyToken.balanceOf(alice) == 1, "got it");
        vm.expectRevert(abi.encodeWithSelector(PrimaryClosed.selector));
        vm.prank(bob);
        tinyCurve.mint(1);
        require(tinyCurve.n() == 1, "bob not counted");
    }

    function test_roundTripReserveIsZeroAndPartialMatchesTarget() public {
        uint256 quoted = curve.quoteMint(4 ether);
        _mint(alice, 1 ether);
        _mint(alice, 3 ether);
        require(curve.reserve() == quoted, "chunks match one buy");
        require(address(curve).balance == curve.reserve(), "cash");
        require(curve.reserve() == probe.target(SLOPE, BASE, 4 ether), "target");

        vm.prank(alice);
        curve.sell(1 ether);
        require(curve.supply() == 3 ether, "supply");
        require(curve.reserve() == probe.target(SLOPE, BASE, 3 ether), "partial target");
        require(address(curve).balance == curve.reserve(), "partial cash");
        require(curve.reserve() > 0, "still funded");

        vm.prank(alice);
        curve.sell(3 ether);
        require(curve.supply() == 0, "flat");
        require(curve.reserve() == 0, "reserve zero");
        require(address(curve).balance == 0, "cash zero");
    }

    function test_curveSellWorksWithNoPoolLiquidity() public {
        _mint(alice, 2 ether);
        require(pool.lpSupply() == 0, "no lp");
        vm.prank(alice);
        curve.sell(2 ether);
        require(curve.reserve() == 0, "redeemed");
        require(token.balanceOf(alice) == 0, "burned");
    }

    function test_poolPriceCanExceedCurveAndExhaustedQuotaCanBuy() public {
        _mint(alice, QUOTA0);
        _mint(bob, 1 ether);
        vm.prank(bob);
        token.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        pool.addLiquidity{value: 100 ether}(1 ether, 0);

        uint256 curvePrice = curve.marginalPrice();
        uint256 poolPrice = pool.priceBnbPerToken();
        require(poolPrice > curvePrice, "pool above curve");

        uint256 before = token.balanceOf(alice);
        vm.expectRevert(abi.encodeWithSelector(QuotaExceeded.selector));
        vm.prank(alice);
        curve.mint{value: 1 ether}(1);

        vm.prank(alice);
        uint256 out = pool.swap{value: 1 ether}(false, 1 ether, 1);
        require(out > 0, "bought");
        require(token.balanceOf(alice) == before + out, "pool tokens");
        require(curve.mintedOf(alice) == QUOTA0, "quota still full");
    }

    function test_feeStaysInThePool() public {
        _mint(alice, 5 ether);
        vm.prank(alice);
        token.approve(address(pool), type(uint256).max);
        vm.prank(alice);
        pool.addLiquidity{value: 5 ether}(5 ether, 0);

        uint256 amountIn = 1 ether;
        uint256 noFee = pool.tokenReserve() * amountIn / (pool.bnbReserve() + amountIn);
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        uint256 out = pool.swap{value: amountIn}(false, amountIn, 0);
        uint256 expected = 5 ether * (amountIn * 997) / (5 ether * 1000 + amountIn * 997);
        require(out == expected, "fee quote");
        require(out < noFee, "fee kept");
        require(bob.balance == bobBefore - amountIn, "bob paid the pool");
        require(pool.bnbReserve() == 6 ether, "full bnb stayed");
    }

    function test_creatorCannotChangeParameters() public {
        require(curve.slope() == factory.slope(), "slope");
        require(curve.quota0() == factory.quota0(), "quota");
        require(curve.base() == factory.base(), "base");
        require(curve.SCALE() == 100 && factory.SCALE() == 100, "scale");
        (bool slopeOk,) = address(curve).call(abi.encodeWithSignature("setSlope(uint256)", 1));
        (bool ownerOk,) = address(factory).call(abi.encodeWithSignature("owner()"));
        (bool pauseOk,) = address(factory).call(abi.encodeWithSignature("pause()"));
        require(!slopeOk && !ownerOk && !pauseOk, "no admin");

        vm.expectRevert(abi.encodeWithSelector(AlreadyWired.selector));
        vm.prank(address(factory));
        token.wire(address(curve), address(pool));
    }

    function test_onlyPoolIsExempt() public {
        _mint(alice, 1 ether);
        vm.prank(alice);
        token.transfer(bob, 0.5 ether);
        require(token.balanceOf(bob) == 0.5 ether, "agent to agent");

        vm.expectRevert(abi.encodeWithSelector(NotAgent.selector));
        vm.prank(alice);
        token.transfer(address(curve), 1);

        vm.expectRevert(abi.encodeWithSelector(NotAgent.selector));
        vm.prank(alice);
        token.transfer(carol, 1);
    }

    function test_txOriginIsNotAuthority() public {
        Forwarder fwd = new Forwarder();
        uint256 cost = curve.quoteMint(1 ether);
        vm.deal(address(fwd), cost);
        vm.expectRevert(abi.encodeWithSelector(NotAgent.selector));
        vm.prank(address(fwd), alice);
        fwd.mint{value: cost}(curve, 1 ether);

        mock.setAgent(address(fwd), 1, "fwd");
        vm.deal(address(fwd), cost);
        vm.prank(address(fwd), carol);
        fwd.mint{value: cost}(curve, 1 ether);
        require(token.balanceOf(address(fwd)) == 1 ether, "msg.sender minted");
    }

    function test_lostAgentCannotSellOrRemoveLiquidity() public {
        _mint(alice, 2 ether);
        vm.prank(alice);
        token.approve(address(pool), type(uint256).max);
        vm.prank(alice);
        uint256 lp = pool.addLiquidity{value: 1 ether}(1 ether, 0);
        uint256 tokens = token.balanceOf(alice);
        uint256 shares = pool.lpOf(alice);
        require(lp == shares && shares > 0, "lp");

        mock.setBalance(alice, 0);
        vm.expectRevert(abi.encodeWithSelector(NotAgent.selector));
        vm.prank(alice);
        curve.sell(1 ether);
        vm.expectRevert(abi.encodeWithSelector(NotAgent.selector));
        vm.prank(alice);
        pool.removeLiquidity(shares, 0, 0);
        require(token.balanceOf(alice) == tokens, "tokens stay");
        require(pool.lpOf(alice) == shares, "lp stays");
        require(pool.bnbReserve() == 1 ether, "bnb stays");
    }

    function test_reentrancyDoesNotDoubleSell() public {
        ReenteringAgent bad = new ReenteringAgent(curve);
        mock.setAgent(address(bad), 1, "bad");
        uint256 cost = curve.quoteMint(2 ether);
        vm.deal(address(bad), cost);
        vm.prank(address(bad));
        bad.mint{value: cost}(2 ether);
        vm.prank(address(bad));
        bad.sell(1 ether);
        require(token.balanceOf(address(bad)) == 1 ether, "one sell");
        require(curve.supply() == 1 ether, "supply");
        require(curve.reserve() == probe.target(SLOPE, BASE, 1 ether), "reserve");
    }

    function test_agentContractCanSell() public {
        AgentSink sink = new AgentSink();
        mock.setAgent(address(sink), 1, "sink");
        uint256 cost = curve.quoteMint(1 ether);
        vm.deal(address(sink), cost);
        vm.prank(address(sink));
        sink.mint{value: cost}(curve, 1 ether);
        vm.prank(address(sink));
        sink.sell(curve, 1 ether);
        require(token.balanceOf(address(sink)) == 0, "sold");
        require(curve.reserve() == 0, "flat");
    }

    function test_excessMintValueIsRefunded() public {
        uint256 cost = curve.quoteMint(1 ether);
        uint256 before = alice.balance;
        vm.prank(alice);
        curve.mint{value: cost + 1 ether}(1 ether);
        require(alice.balance == before - cost, "refund");
        require(address(curve).balance == curve.reserve(), "no donation");
    }

    function test_twoMarketsAreIsolated() public {
        vm.prank(bob);
        (address t2, address c2,) = factory.create("Other", "OTH");
        require(t2 != address(token), "token");
        _mint(alice, 1 ether);
        require(CensusCurve(c2).supply() == 0, "other supply");
        require(CensusToken(t2).totalSupply() == 0, "other mint");
    }

    function test_nonAgentCannotCreate() public {
        vm.expectRevert(abi.encodeWithSelector(NotAgent.selector));
        vm.prank(carol);
        factory.create("Nope", "NO");
    }

    function test_emptyNameReverts() public {
        vm.expectRevert(abi.encodeWithSelector(BadName.selector));
        vm.prank(alice);
        factory.create("", "Q");
    }

    function test_directBurnIsRejected() public {
        _mint(alice, 1 ether);
        vm.expectRevert();
        vm.prank(alice);
        token.burn(alice, 1 ether);
    }

    function test_productionFactoryRejectsWrongChainAndPinsRegistry() public {
        vm.expectRevert(abi.encodeWithSelector(WrongChain.selector));
        new CensusCurveFactory();

        vm.chainId(56);
        CensusCurveFactory prod = new CensusCurveFactory();
        require(prod.AGENT() == 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F, "registry");
        require(prod.SCALE() == 100, "scale");
        require(prod.SLOPE() == 1e15 && prod.BASE() == 1e15 && prod.QUOTA0() == 100 ether, "economics");

        address reg = prod.AGENT();
        vm.etch(reg, address(mock).code);
        MockAgentId(reg).setAgent(alice, 1, "alice");
        vm.prank(alice);
        (address t, address c, address p) = prod.create("Prod", "PRD");
        require(address(CensusCurve(c).agent()) == reg, "curve registry");
        require(CensusToken(t).pool() == p, "pool wired");
        require(CensusCurve(c).SCALE() == 100, "curve scale");
    }

    function testFuzz_roundTripReserve(uint96 raw) public {
        uint256 amount = (uint256(raw) % QUOTA0) + 1;
        if (amount > QUOTA0) amount = QUOTA0;
        uint256 cost = curve.quoteMint(amount);
        vm.deal(alice, cost);
        vm.prank(alice);
        curve.mint{value: cost}(amount);
        vm.prank(alice);
        curve.sell(amount);
        require(curve.reserve() == 0, "reserve");
        require(address(curve).balance == 0, "cash");
        require(curve.supply() == 0, "supply");
    }

    function testFuzz_partialSellStaysOnTarget(uint96 a, uint96 b) public {
        uint256 x = (uint256(a) % (QUOTA0 / 2)) + 1;
        uint256 y = (uint256(b) % (QUOTA0 / 2)) + 1;
        _mint(alice, x);
        _mint(alice, y);
        vm.prank(alice);
        curve.sell(x);
        require(curve.supply() == y, "left");
        require(curve.reserve() == probe.target(SLOPE, BASE, y), "target");
        require(address(curve).balance == curve.reserve(), "cash");
    }

    function _mint(address who, uint256 amount) internal {
        uint256 cost = curve.quoteMint(amount);
        vm.prank(who);
        curve.mint{value: cost}(amount);
    }
}
