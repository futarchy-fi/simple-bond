// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IBondJudgeV5.sol";

interface IBondJudgeTarget {
    /// @notice Record a ruling in favor of the poster on a target bond contract.
    /// @param bondId The bond to rule on.
    /// @param feeCharged The judge fee charged for the ruling.
    function ruleForPoster(uint256 bondId, uint256 feeCharged) external;
    /// @notice Record a ruling in favor of the challenger on a target bond contract.
    /// @param bondId The bond to rule on.
    /// @param feeCharged The judge fee charged for the ruling.
    function ruleForChallenger(uint256 bondId, uint256 feeCharged) external;
    /// @notice Reject a bond on a target bond contract.
    /// @param bondId The bond to reject.
    function rejectBond(uint256 bondId) external;
}

/// @title ManualJudge
/// @notice Minimal human-operated judge wrapper for SimpleBondV5-style cores.
/// @dev This contract is intentionally portable across compatible bond
/// contracts. It is not bound to a single SimpleBond instance so a later core
/// version can reuse the same wrapper instead of forcing redeployment.
contract ManualJudge is IBondJudgeV5 {
    using SafeERC20 for IERC20;

    /// @notice Returns the address that may accept the operator role.
    address public immutable proposedOperator;
    /// @notice Returns the active operator address after acceptance.
    address public operator;
    /// @notice Returns whether the proposed operator has activated this judge.
    bool public active;

    event OperatorAccepted(address indexed operator);
    event FeesWithdrawn(address indexed token, address indexed to, uint256 amount);

    /// @notice Initialize the judge wrapper with a proposed operator.
    /// @param _proposedOperator Address allowed to accept the operator role.
    constructor(address _proposedOperator) {
        require(_proposedOperator != address(0), "Zero operator");

        proposedOperator = _proposedOperator;
    }

    /// @notice Accept the operator role and activate this judge wrapper.
    function acceptOperatorRole() external {
        require(msg.sender == proposedOperator, "Only proposed operator");
        require(!active, "Already active");

        // Explicit acceptance prevents third parties from silently naming some
        // EOA or Safe as a judge without that operator opting in.
        operator = msg.sender;
        active = true;

        emit OperatorAccepted(msg.sender);
    }

    /// @notice Validate proposed bond terms for creation-time compatibility.
    /// @dev ManualJudge ignores the actual terms and only requires that the operator accepted activation.
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
    ) external view override {
        token;
        bondAmount;
        challengeAmount;
        judgeFee;
        deadline;
        acceptanceDelay;
        rulingBuffer;
        // ManualJudge does not inspect bond terms. Its only creation-time
        // policy is whether the proposed operator has accepted activation.
        require(active, "Judge inactive");
    }

    /// @notice Withdraw fees accrued to this wrapper contract.
    /// @param token ERC-20 token to withdraw.
    /// @param to Recipient address.
    /// @param amount Amount of tokens to transfer.
    function withdrawFees(address token, address to, uint256 amount) external {
        require(msg.sender == operator, "Only operator");
        require(to != address(0), "Zero recipient");

        // The bond core pays the wrapper contract directly, so the wrapper
        // needs an explicit path to forward accrued fees onward.
        IERC20(token).safeTransfer(to, amount);

        emit FeesWithdrawn(token, to, amount);
    }

    /// @notice Forward a poster-favoring ruling to a compatible bond contract.
    /// @param bondContract Target bond contract to call.
    /// @param bondId Bond to rule on.
    /// @param feeCharged Judge fee charged for the ruling.
    function ruleForPoster(address bondContract, uint256 bondId, uint256 feeCharged) external {
        require(msg.sender == operator, "Only operator");
        IBondJudgeTarget(bondContract).ruleForPoster(bondId, feeCharged);
    }

    /// @notice Forward a challenger-favoring ruling to a compatible bond contract.
    /// @param bondContract Target bond contract to call.
    /// @param bondId Bond to rule on.
    /// @param feeCharged Judge fee charged for the ruling.
    function ruleForChallenger(address bondContract, uint256 bondId, uint256 feeCharged) external {
        require(msg.sender == operator, "Only operator");
        IBondJudgeTarget(bondContract).ruleForChallenger(bondId, feeCharged);
    }

    /// @notice Forward a bond rejection to a compatible bond contract.
    /// @param bondContract Target bond contract to call.
    /// @param bondId Bond to reject.
    function rejectBond(address bondContract, uint256 bondId) external {
        require(msg.sender == operator, "Only operator");
        IBondJudgeTarget(bondContract).rejectBond(bondId);
    }
}
