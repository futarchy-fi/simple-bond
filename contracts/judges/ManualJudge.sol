// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IBondJudgeV5.sol";

interface IBondJudgeTarget {
    function ruleForPoster(uint256 bondId, uint256 feeCharged) external;
    function ruleForChallenger(uint256 bondId, uint256 feeCharged) external;
    function rejectBond(uint256 bondId) external;
}

/// @title ManualJudge
/// @notice Minimal human-operated judge wrapper for SimpleBondV5-style cores.
/// @dev This contract is intentionally portable across compatible bond
/// contracts. It is not bound to a single SimpleBond instance so a later core
/// version can reuse the same wrapper instead of forcing redeployment.
contract ManualJudge is IBondJudgeV5 {
    address public immutable proposedOperator;
    address public operator;
    bool public active;

    event OperatorAccepted(address indexed operator);

    constructor(address _proposedOperator) {
        require(_proposedOperator != address(0), "Zero operator");

        proposedOperator = _proposedOperator;
    }

    function acceptOperatorRole() external {
        require(msg.sender == proposedOperator, "Only proposed operator");
        require(!active, "Already active");

        // Explicit acceptance prevents third parties from silently naming some
        // EOA or Safe as a judge without that operator opting in.
        operator = msg.sender;
        active = true;

        emit OperatorAccepted(msg.sender);
    }

    function validateBond(
        address,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256
    ) external view override {
        // ManualJudge does not inspect bond terms. Its only creation-time
        // policy is whether the proposed operator has accepted activation.
        require(active, "Judge inactive");
    }

    function ruleForPoster(address bondContract, uint256 bondId, uint256 feeCharged) external {
        require(msg.sender == operator, "Only operator");
        IBondJudgeTarget(bondContract).ruleForPoster(bondId, feeCharged);
    }

    function ruleForChallenger(address bondContract, uint256 bondId, uint256 feeCharged) external {
        require(msg.sender == operator, "Only operator");
        IBondJudgeTarget(bondContract).ruleForChallenger(bondId, feeCharged);
    }

    function rejectBond(address bondContract, uint256 bondId) external {
        require(msg.sender == operator, "Only operator");
        IBondJudgeTarget(bondContract).rejectBond(bondId);
    }
}
