// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Generic creation-time compatibility hook for SimpleBondV5 judges.
/// @dev This hook is intentionally narrow: it lets the bond core verify that a
/// compatible judge contract accepts the proposed static terms, while keeping
/// later dispute-handling policy inside the judge implementation itself.
interface IBondJudgeV5 {
    /// @notice Revert if this judge refuses the proposed bond terms.
    /// @dev A successful call does not obligate the judge to later rule on the
    /// merits. The judge may still reject the bond later or simply do nothing
    /// until timeout, depending on its own policy.
    /// @param token ERC-20 token proposed for the bond.
    /// @param bondAmount Bond collateral amount proposed by the poster.
    /// @param challengeAmount Challenge amount proposed for each challenger.
    /// @param judgeFee Maximum judge fee proposed per ruling.
    /// @param deadline Challenge deadline proposed for the bond.
    /// @param acceptanceDelay Delay after a challenge before ruling may begin.
    /// @param rulingBuffer Length of the ruling window after it opens.
    function validateBond(
        address token,
        uint256 bondAmount,
        uint256 challengeAmount,
        uint256 judgeFee,
        uint256 deadline,
        uint256 acceptanceDelay,
        uint256 rulingBuffer
    ) external view;
}
