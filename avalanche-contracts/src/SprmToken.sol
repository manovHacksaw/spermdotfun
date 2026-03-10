// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title SPRM Token
/// @notice ERC20 token used for all betting in Sprm.Fun.
///         Minting is restricted to addresses holding MINTER_ROLE (Faucet, GameHouseBank).
contract SprmToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    constructor(address admin) ERC20("SPRM", "SPRM") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    /// @notice Mint tokens. Only callable by MINTER_ROLE holders.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @notice Burn tokens from the caller's balance.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
