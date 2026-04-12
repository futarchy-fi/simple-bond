// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IJudgeProfileControlled.sol";

/// @title JudgeRegistry
/// @notice Canonical on-chain mapping from judge operators to judge contracts.
/// @dev Each operator has at most one canonical judge and each judge has at most
/// one canonical operator at a time. Judge contracts are expected to expose a
/// controller via `profileController()`.
contract JudgeRegistry {
    address public owner;
    address public pendingOwner;
    address public admin;
    address public pendingAdmin;
    bool public writesPaused;

    mapping(address => address) public judgeOf;
    mapping(address => address) public operatorOf;

    mapping(address => bool) private seenJudges;
    address[] private judgeAddresses;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AdminTransferStarted(address indexed previousAdmin, address indexed pendingAdmin);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event WritesPausedSet(bool paused);
    event JudgeRegistered(address indexed operator, address indexed judge, address indexed editor);
    event JudgeCleared(address indexed operator, address indexed judge, address indexed editor);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyOwnerOrAdmin() {
        require(msg.sender == owner || msg.sender == admin, "Only owner or admin");
        _;
    }

    modifier whenWritesNotPaused() {
        require(!writesPaused, "Writes paused");
        _;
    }

    constructor(address initialOwner, address initialAdmin) {
        require(initialOwner != address(0), "Zero owner");
        require(initialAdmin != address(0), "Zero admin");

        owner = initialOwner;
        admin = initialAdmin;

        emit OwnershipTransferred(address(0), initialOwner);
        emit AdminTransferred(address(0), initialAdmin);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero owner");

        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Only pending owner");

        address previousOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);

        emit OwnershipTransferred(previousOwner, msg.sender);
    }

    function transferAdmin(address newAdmin) external onlyOwnerOrAdmin {
        require(newAdmin != address(0), "Zero admin");

        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external {
        require(msg.sender == pendingAdmin, "Only pending admin");

        address previousAdmin = admin;
        admin = msg.sender;
        pendingAdmin = address(0);

        emit AdminTransferred(previousAdmin, msg.sender);
    }

    function setWritesPaused(bool paused) external onlyOwnerOrAdmin {
        writesPaused = paused;
        emit WritesPausedSet(paused);
    }

    function judgeCount() external view returns (uint256) {
        return judgeAddresses.length;
    }

    function judgeAt(uint256 index) external view returns (address) {
        return judgeAddresses[index];
    }

    function controllerOf(address judge) public view returns (address) {
        if (judge.code.length == 0) {
            return address(0);
        }

        try IJudgeProfileControlled(judge).profileController() returns (address controller) {
            return controller;
        } catch {
            return address(0);
        }
    }

    function canRegister(address operator, address judge) public view returns (bool) {
        if (operator == address(0) || judge.code.length == 0) {
            return false;
        }

        return controllerOf(judge) == operator;
    }

    function setJudge(address judge) external whenWritesNotPaused {
        require(canRegister(msg.sender, judge), "Not judge controller");
        _setJudge(msg.sender, judge, msg.sender);
    }

    function clearMyJudge() external {
        address judge = judgeOf[msg.sender];
        require(judge != address(0), "Judge not found");

        _clearJudge(msg.sender, judge, msg.sender);
    }

    function setJudgeFor(address operator, address judge) external onlyOwnerOrAdmin whenWritesNotPaused {
        require(operator != address(0), "Zero operator");
        require(judge.code.length > 0, "Judge must be contract");

        _setJudge(operator, judge, msg.sender);
    }

    function clearJudgeFor(address operator) external onlyOwnerOrAdmin {
        address judge = judgeOf[operator];
        require(judge != address(0), "Judge not found");

        _clearJudge(operator, judge, msg.sender);
    }

    function _setJudge(address operator, address judge, address editor) internal {
        address currentJudge = judgeOf[operator];
        address currentOperator = operatorOf[judge];

        if (!seenJudges[judge]) {
            seenJudges[judge] = true;
            judgeAddresses.push(judge);
        }

        if (currentJudge != address(0) && currentJudge != judge) {
            operatorOf[currentJudge] = address(0);
            emit JudgeCleared(operator, currentJudge, editor);
        }

        if (currentOperator != address(0) && currentOperator != operator) {
            judgeOf[currentOperator] = address(0);
            emit JudgeCleared(currentOperator, judge, editor);
        }

        judgeOf[operator] = judge;
        operatorOf[judge] = operator;

        emit JudgeRegistered(operator, judge, editor);
    }

    function _clearJudge(address operator, address judge, address editor) internal {
        delete judgeOf[operator];

        if (operatorOf[judge] == operator) {
            delete operatorOf[judge];
        }

        emit JudgeCleared(operator, judge, editor);
    }
}
