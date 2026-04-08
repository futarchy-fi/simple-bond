// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBondJudgeV5 {
    /// @notice Revert if this judge refuses the proposed bond terms.
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
