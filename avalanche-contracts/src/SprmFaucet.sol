// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SprmToken} from "./SprmToken.sol";

/// @title SPRM Faucet
/// @notice Rate-limited faucet: each wallet can claim 50 SPRM every 24 hours.
///         The Faucet must hold MINTER_ROLE on SprmToken to mint.
contract SprmFaucet is Ownable {
    SprmToken public immutable token;

    uint256 public claimAmount = 50 ether; // 50 SPRM (18 decimals)
    uint256 public cooldown    = 24 hours;

    mapping(address => uint256) public lastClaim;

    event Claimed(address indexed user, uint256 amount);
    event ClaimAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event CooldownUpdated(uint256 oldCooldown, uint256 newCooldown);

    constructor(address _token) Ownable(msg.sender) {
        token = SprmToken(_token);
    }

    /// @notice Claim SPRM tokens. Reverts if called within the cooldown window.
    function claim() external {
        require(
            block.timestamp >= lastClaim[msg.sender] + cooldown,
            "Faucet: cooldown not elapsed"
        );
        lastClaim[msg.sender] = block.timestamp;
        token.mint(msg.sender, claimAmount);
        emit Claimed(msg.sender, claimAmount);
    }

    /// @notice Seconds until the caller can claim again (0 if claimable now).
    function timeUntilNextClaim(address user) external view returns (uint256) {
        uint256 next = lastClaim[user] + cooldown;
        if (block.timestamp >= next) return 0;
        return next - block.timestamp;
    }

    // ── Admin ──────────────────────────────────────────────────────────────────

    function setClaimAmount(uint256 _amount) external onlyOwner {
        emit ClaimAmountUpdated(claimAmount, _amount);
        claimAmount = _amount;
    }

    function setCooldown(uint256 _cooldown) external onlyOwner {
        emit CooldownUpdated(cooldown, _cooldown);
        cooldown = _cooldown;
    }
}
