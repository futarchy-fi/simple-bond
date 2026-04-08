// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IBondJudgeV5.sol";

interface IBondJudgeTarget {
    function ruleForPoster(uint256 bondId, uint256 feeCharged) external;
    function ruleForChallenger(uint256 bondId, uint256 feeCharged) external;
    function rejectBond(uint256 bondId) external;
}

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
