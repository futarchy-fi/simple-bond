// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title OfficialBondDirectory
/// @notice Futarchy-curated on-chain directory of official judge contracts and ERC-20 tokens.
/// @dev This directory is a UI curation layer. It does not gate the permissionless V5 core.
contract OfficialBondDirectory {
    uint256 public constant MAX_JUDGE_DISPLAY_NAME_LENGTH = 120;
    uint256 public constant MAX_JUDGE_STATEMENT_LENGTH = 4_000;
    uint256 public constant MAX_LINK_URI_LENGTH = 500;
    uint256 public constant MAX_TOKEN_SYMBOL_LENGTH = 32;
    uint256 public constant MAX_TOKEN_DISPLAY_NAME_LENGTH = 120;

    struct JudgeEntry {
        bool exists;
        bool enabled;
        uint32 sortOrder;
        string displayName;
        string statement;
        string linkURI;
        uint64 updatedAt;
    }

    struct TokenEntry {
        bool exists;
        bool enabled;
        bool isDefaultToken;
        bool isWrappedNative;
        uint8 decimals;
        uint32 sortOrder;
        string symbol;
        string displayName;
        uint64 updatedAt;
    }

    address public owner;
    address public pendingOwner;
    address public admin;
    address public pendingAdmin;
    bool public writesPaused;
    address public defaultToken;
    address public wrappedNativeToken;

    mapping(address => JudgeEntry) private judgeEntries;
    address[] private judgeAddresses;

    mapping(address => TokenEntry) private tokenEntries;
    address[] private tokenAddresses;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AdminTransferStarted(address indexed previousAdmin, address indexed pendingAdmin);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event WritesPausedSet(bool paused);
    event JudgeSet(address indexed judge, bool enabled, uint32 sortOrder);
    event TokenSet(
        address indexed token,
        bool enabled,
        bool isDefaultToken,
        bool isWrappedNative,
        uint32 sortOrder
    );

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

    function tokenCount() external view returns (uint256) {
        return tokenAddresses.length;
    }

    function tokenAt(uint256 index) external view returns (address) {
        return tokenAddresses[index];
    }

    function hasJudge(address judge) external view returns (bool) {
        return judgeEntries[judge].exists;
    }

    function hasToken(address token) external view returns (bool) {
        return tokenEntries[token].exists;
    }

    function getJudge(
        address judge
    )
        external
        view
        returns (
            bool enabled,
            uint32 sortOrder,
            string memory displayName,
            string memory statement,
            string memory linkURI,
            uint64 updatedAt
        )
    {
        JudgeEntry storage entry = judgeEntries[judge];
        return (
            entry.enabled,
            entry.sortOrder,
            entry.displayName,
            entry.statement,
            entry.linkURI,
            entry.updatedAt
        );
    }

    function getToken(
        address token
    )
        external
        view
        returns (
            bool enabled,
            bool isDefaultToken,
            bool isWrappedNative,
            uint8 decimals,
            uint32 sortOrder,
            string memory symbol,
            string memory displayName,
            uint64 updatedAt
        )
    {
        TokenEntry storage entry = tokenEntries[token];
        return (
            entry.enabled,
            entry.isDefaultToken,
            entry.isWrappedNative,
            entry.decimals,
            entry.sortOrder,
            entry.symbol,
            entry.displayName,
            entry.updatedAt
        );
    }

    function setJudge(
        address judge,
        bool enabled,
        uint32 sortOrder,
        string calldata displayName,
        string calldata statement,
        string calldata linkURI
    ) external onlyOwnerOrAdmin whenWritesNotPaused {
        require(judge != address(0), "Zero judge");
        require(judge.code.length > 0, "Judge must be contract");

        _validateJudgeFields(displayName, statement, linkURI);

        if (!judgeEntries[judge].exists) {
            judgeEntries[judge].exists = true;
            judgeAddresses.push(judge);
        }

        judgeEntries[judge].enabled = enabled;
        judgeEntries[judge].sortOrder = sortOrder;
        judgeEntries[judge].displayName = displayName;
        judgeEntries[judge].statement = statement;
        judgeEntries[judge].linkURI = linkURI;
        judgeEntries[judge].updatedAt = uint64(block.timestamp);

        emit JudgeSet(judge, enabled, sortOrder);
    }

    function setToken(
        address token,
        bool enabled,
        bool isDefaultToken_,
        bool isWrappedNative_,
        uint8 decimals,
        uint32 sortOrder,
        string calldata symbol,
        string calldata displayName
    ) external onlyOwnerOrAdmin whenWritesNotPaused {
        require(token != address(0), "Zero token");
        require(token.code.length > 0, "Token must be contract");
        require(enabled || (!isDefaultToken_ && !isWrappedNative_), "Disabled token cannot be special");

        _validateTokenFields(symbol, displayName);

        if (!tokenEntries[token].exists) {
            tokenEntries[token].exists = true;
            tokenAddresses.push(token);
        }

        _setDefaultToken(token, isDefaultToken_);
        _setWrappedNativeToken(token, isWrappedNative_);

        tokenEntries[token].enabled = enabled;
        tokenEntries[token].decimals = decimals;
        tokenEntries[token].sortOrder = sortOrder;
        tokenEntries[token].symbol = symbol;
        tokenEntries[token].displayName = displayName;
        tokenEntries[token].updatedAt = uint64(block.timestamp);

        if (!enabled) {
            if (defaultToken == token) {
                defaultToken = address(0);
            }
            if (wrappedNativeToken == token) {
                wrappedNativeToken = address(0);
            }
            tokenEntries[token].isDefaultToken = false;
            tokenEntries[token].isWrappedNative = false;
        }

        emit TokenSet(
            token,
            tokenEntries[token].enabled,
            tokenEntries[token].isDefaultToken,
            tokenEntries[token].isWrappedNative,
            sortOrder
        );
    }

    function _setDefaultToken(address token, bool makeDefault) internal {
        if (!makeDefault) {
            if (defaultToken == token) {
                defaultToken = address(0);
            }
            tokenEntries[token].isDefaultToken = false;
            return;
        }

        if (defaultToken != address(0) && defaultToken != token) {
            tokenEntries[defaultToken].isDefaultToken = false;
        }

        defaultToken = token;
        tokenEntries[token].isDefaultToken = true;
    }

    function _setWrappedNativeToken(address token, bool makeWrappedNative) internal {
        if (!makeWrappedNative) {
            if (wrappedNativeToken == token) {
                wrappedNativeToken = address(0);
            }
            tokenEntries[token].isWrappedNative = false;
            return;
        }

        if (wrappedNativeToken != address(0) && wrappedNativeToken != token) {
            tokenEntries[wrappedNativeToken].isWrappedNative = false;
        }

        wrappedNativeToken = token;
        tokenEntries[token].isWrappedNative = true;
    }

    function _validateJudgeFields(
        string calldata displayName,
        string calldata statement,
        string calldata linkURI
    ) internal pure {
        require(bytes(displayName).length <= MAX_JUDGE_DISPLAY_NAME_LENGTH, "Judge display name too long");
        require(bytes(statement).length <= MAX_JUDGE_STATEMENT_LENGTH, "Judge statement too long");
        require(bytes(linkURI).length <= MAX_LINK_URI_LENGTH, "Judge link too long");
    }

    function _validateTokenFields(
        string calldata symbol,
        string calldata displayName
    ) internal pure {
        require(bytes(symbol).length > 0, "Empty token symbol");
        require(bytes(symbol).length <= MAX_TOKEN_SYMBOL_LENGTH, "Token symbol too long");
        require(bytes(displayName).length > 0, "Empty token display name");
        require(bytes(displayName).length <= MAX_TOKEN_DISPLAY_NAME_LENGTH, "Token display name too long");
    }
}
