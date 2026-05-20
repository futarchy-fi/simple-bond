// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IBondJudgeV6
/// @notice Interface every v0.6 judge contract must implement.
/// @dev Differs from v0.5 by removing `deadline` and adding `maxChallenges`.
interface IBondJudgeV6 {
    /// @notice Creation-time term-acceptance probe.
    /// @dev Called by `SimpleBondV6.createBond`. Revert to reject the bond.
    function validateBond(
        address token,
        uint256 bondAmount,
        uint256 challengeAmount,
        uint256 judgeFee,
        uint256 acceptanceDelay,
        uint256 rulingBuffer,
        uint256 maxChallenges
    ) external view;
}
