// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SimpleBond
 * @notice Minimal bond contract. A poster locks an ERC-20 token as a bond,
 *         names a judge and a deadline. The judge can forfeit the bond to a
 *         challenger before the deadline. If no ruling by the deadline, the
 *         poster withdraws. Use a yield-bearing token (sDAI, sUSDS) to earn
 *         float while the bond is locked.
 */
contract SimpleBond {
    using SafeERC20 for IERC20;

    struct Bond {
        address poster;
        address judge;
        address token;
        uint256 amount;
        uint256 deadline;
        bool settled;       // true once forfeited or withdrawn
    }

    uint256 public nextBondId;
    mapping(uint256 => Bond) public bonds;

    event BondCreated(
        uint256 indexed bondId,
        address indexed poster,
        address indexed judge,
        address token,
        uint256 amount,
        uint256 deadline
    );
    event BondForfeited(uint256 indexed bondId, address indexed recipient);
    event BondWithdrawn(uint256 indexed bondId);

    /**
     * @notice Create a bond. Caller deposits `amount` of `token`.
     * @param token  ERC-20 token to lock (use sDAI/sUSDS for yield)
     * @param amount Amount to lock
     * @param judge  Address authorized to forfeit the bond
     * @param deadline Unix timestamp — poster can withdraw after this
     */
    function createBond(
        address token,
        uint256 amount,
        address judge,
        uint256 deadline
    ) external returns (uint256 bondId) {
        require(amount > 0, "Zero amount");
        require(judge != address(0), "Zero judge");
        require(deadline > block.timestamp, "Deadline in past");

        bondId = nextBondId++;
        bonds[bondId] = Bond({
            poster: msg.sender,
            judge: judge,
            token: token,
            amount: amount,
            deadline: deadline,
            settled: false
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit BondCreated(bondId, msg.sender, judge, token, amount, deadline);
    }

    /**
     * @notice Judge forfeits the bond to a recipient (the challenger).
     *         Must be called before the deadline.
     */
    function forfeit(uint256 bondId, address recipient) external {
        Bond storage b = bonds[bondId];
        require(!b.settled, "Already settled");
        require(msg.sender == b.judge, "Only judge");
        require(block.timestamp <= b.deadline, "Past deadline");
        require(recipient != address(0), "Zero recipient");

        b.settled = true;
        IERC20(b.token).safeTransfer(recipient, b.amount);

        emit BondForfeited(bondId, recipient);
    }

    /**
     * @notice Poster withdraws the bond after the deadline (no ruling).
     */
    function withdraw(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(!b.settled, "Already settled");
        require(msg.sender == b.poster, "Only poster");
        require(block.timestamp > b.deadline, "Before deadline");

        b.settled = true;
        IERC20(b.token).safeTransfer(b.poster, b.amount);

        emit BondWithdrawn(bondId);
    }
}
