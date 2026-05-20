// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IBondJudgeV6.sol";

interface IBondJudgeTargetV6 {
    function ruleForPoster(uint256 bondId, uint256 i, uint256 feeCharged, string calldata content) external;
    function ruleForChallenger(uint256 bondId, uint256 i, uint256 feeCharged, string calldata content) external;
    function rejectChallenge(uint256 bondId, uint256 i, string calldata content) external;
    function rejectBond(uint256 bondId, string calldata content) external;
}

/// @title ManualJudgeV6
/// @notice Human-operated judge wrapper for SimpleBondV6-style cores.
/// @dev Portable across compatible bond contracts. The operator opts in via
///      `acceptOperatorRole`. Fees accrue to this contract until withdrawn.
contract ManualJudgeV6 is IBondJudgeV6 {
    using SafeERC20 for IERC20;

    address public immutable proposedOperator;
    address public operator;
    bool public active;

    event OperatorAccepted(address indexed operator);
    event FeesWithdrawn(address indexed token, address indexed to, uint256 amount);

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

    function withdrawFees(address token, address to, uint256 amount) external {
        require(msg.sender == operator, "Only operator");
        require(to != address(0), "Zero recipient");
        IERC20(token).safeTransfer(to, amount);
        emit FeesWithdrawn(token, to, amount);
    }

    function ruleForPoster(
        address bondContract,
        uint256 bondId,
        uint256 i,
        uint256 feeCharged,
        string calldata content
    ) external {
        require(msg.sender == operator, "Only operator");
        IBondJudgeTargetV6(bondContract).ruleForPoster(bondId, i, feeCharged, content);
    }

    function ruleForChallenger(
        address bondContract,
        uint256 bondId,
        uint256 i,
        uint256 feeCharged,
        string calldata content
    ) external {
        require(msg.sender == operator, "Only operator");
        IBondJudgeTargetV6(bondContract).ruleForChallenger(bondId, i, feeCharged, content);
    }

    function rejectChallenge(
        address bondContract,
        uint256 bondId,
        uint256 i,
        string calldata content
    ) external {
        require(msg.sender == operator, "Only operator");
        IBondJudgeTargetV6(bondContract).rejectChallenge(bondId, i, content);
    }

    function rejectBond(address bondContract, uint256 bondId, string calldata content) external {
        require(msg.sender == operator, "Only operator");
        IBondJudgeTargetV6(bondContract).rejectBond(bondId, content);
    }
}
