// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MulDiv} from "./MulDiv.sol";

/// @notice Bonding-curve integral from the spec, with supply counted in wei
/// and slope/base counted in wei per whole token.
///
/// For a whole-token supply U = s / 1e18 the accounted BNB is
/// slope * U^2 / 2 + base * U, floored. That is the spec cost from 0 to U.
/// A segment from s0 to s1 charges target(s1) - target(s0). Chunking a buy
/// therefore costs the same as one buy, and a sell refunds exactly the BNB
/// that segment had added. The division dust is never collected, so a full
/// sell returns the reserve to zero instead of paying out more than came in.
library CurveMath {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant QUAD_DENOM = 2e36;

    function target(uint256 slope, uint256 base, uint256 s) internal pure returns (uint256) {
        if (s == 0) return 0;
        uint256 slopeS = MulDiv.mulDiv(slope, s, 1);
        uint256 quad = MulDiv.mulDiv(slopeS, s, QUAD_DENOM);
        uint256 linear = MulDiv.mulDiv(base, s, WAD);
        return quad + linear;
    }

    /// @dev BNB that moves when supply goes from the lower bound to the upper one.
    function span(uint256 slope, uint256 base, uint256 s0, uint256 s1) internal pure returns (uint256) {
        if (s0 == s1) return 0;
        (uint256 lo, uint256 hi) = s0 < s1 ? (s0, s1) : (s1, s0);
        return target(slope, base, hi) - target(slope, base, lo);
    }
}
