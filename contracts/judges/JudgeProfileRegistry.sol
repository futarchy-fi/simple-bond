// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IJudgeProfileControlled.sol";

/// @title JudgeProfileRegistry
/// @notice On-chain public profile registry for contract-based judges.
/// @dev Profiles are keyed by judge contract address. A profile may be edited
/// by the judge contract itself or by the controller address exposed by that
/// judge via `profileController()`.
contract JudgeProfileRegistry {
    uint256 public constant MAX_DISPLAY_NAME_LENGTH = 120;
    uint256 public constant MAX_STATEMENT_LENGTH = 4_000;
    uint256 public constant MAX_LINK_URI_LENGTH = 500;
    uint256 public constant MAX_METADATA_URI_LENGTH = 1_000;

    struct JudgeProfile {
        string displayName;
        string statement;
        string linkURI;
        string metadataURI;
        uint64 updatedAt;
    }

    address public owner;
    address public pendingOwner;
    address public admin;
    address public pendingAdmin;
    bool public writesPaused;

    mapping(address => JudgeProfile) private judgeProfiles;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AdminTransferStarted(address indexed previousAdmin, address indexed pendingAdmin);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event WritesPausedSet(bool paused);
    event JudgeProfileUpdated(address indexed judge, address indexed editor);
    event JudgeProfileCleared(address indexed judge, address indexed editor);

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

    function getProfile(
        address judge
    )
        external
        view
        returns (
            string memory displayName,
            string memory statement,
            string memory linkURI,
            string memory metadataURI,
            uint64 updatedAt
        )
    {
        JudgeProfile storage profile = judgeProfiles[judge];
        return (
            profile.displayName,
            profile.statement,
            profile.linkURI,
            profile.metadataURI,
            profile.updatedAt
        );
    }

    function hasProfile(address judge) external view returns (bool) {
        return judgeProfiles[judge].updatedAt != 0;
    }

    function profileControllerOf(address judge) public view returns (address) {
        if (judge.code.length == 0) {
            return address(0);
        }

        try IJudgeProfileControlled(judge).profileController() returns (address controller) {
            return controller;
        } catch {
            return address(0);
        }
    }

    function canEditProfile(address judge, address editor) public view returns (bool) {
        if (judge.code.length == 0) {
            return false;
        }

        if (editor == judge) {
            return true;
        }

        address controller = profileControllerOf(judge);
        return controller != address(0) && controller == editor;
    }

    function setProfile(
        address judge,
        string calldata displayName,
        string calldata statement,
        string calldata linkURI,
        string calldata metadataURI
    ) external whenWritesNotPaused {
        require(canEditProfile(judge, msg.sender), "Not judge controller");
        require(
            bytes(displayName).length > 0 ||
                bytes(statement).length > 0 ||
                bytes(linkURI).length > 0 ||
                bytes(metadataURI).length > 0,
            "Empty profile"
        );

        _validateFieldLengths(displayName, statement, linkURI, metadataURI);

        judgeProfiles[judge] = JudgeProfile({
            displayName: displayName,
            statement: statement,
            linkURI: linkURI,
            metadataURI: metadataURI,
            updatedAt: uint64(block.timestamp)
        });

        emit JudgeProfileUpdated(judge, msg.sender);
    }

    function clearProfile(address judge) external {
        require(canEditProfile(judge, msg.sender), "Not judge controller");
        require(judgeProfiles[judge].updatedAt != 0, "Profile not found");

        delete judgeProfiles[judge];

        emit JudgeProfileCleared(judge, msg.sender);
    }

    function _validateFieldLengths(
        string calldata displayName,
        string calldata statement,
        string calldata linkURI,
        string calldata metadataURI
    ) internal pure {
        require(bytes(displayName).length <= MAX_DISPLAY_NAME_LENGTH, "Display name too long");
        require(bytes(statement).length <= MAX_STATEMENT_LENGTH, "Statement too long");
        require(bytes(linkURI).length <= MAX_LINK_URI_LENGTH, "Link URI too long");
        require(bytes(metadataURI).length <= MAX_METADATA_URI_LENGTH, "Metadata URI too long");
    }
}
