// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SprmToken}      from "../src/SprmToken.sol";
import {SprmFaucet}     from "../src/SprmFaucet.sol";
import {SprmGameSimple} from "../src/SprmGameSimple.sol";

contract DeploySimple is Script {
    function run() external {
        uint256 pk       = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address treasury       = vm.envOr("TREASURY_ADDRESS", deployer);
        address resolverSigner = vm.envOr("RESOLVER_SIGNER",  deployer);
        uint16  edgeBps        = uint16(vm.envOr("HOUSE_EDGE_BPS",  uint256(200)));
        uint256 houseFund      = vm.envOr("HOUSE_BANK_FUND",  uint256(1_000_000 ether));

        vm.startBroadcast(pk);

        SprmToken token = new SprmToken(deployer);
        console.log("SprmToken  :", address(token));

        SprmFaucet faucet = new SprmFaucet(address(token));
        token.grantRole(token.MINTER_ROLE(), address(faucet));
        console.log("SprmFaucet :", address(faucet));

        SprmGameSimple game = new SprmGameSimple(
            address(token), treasury, resolverSigner, edgeBps
        );
        token.grantRole(token.MINTER_ROLE(), address(game));

        // Seed house bank
        token.mint(deployer, houseFund);
        token.approve(address(game), houseFund);
        game.fundHouseBank(houseFund);

        console.log("SprmGame   :", address(game));
        console.log("Treasury   :", treasury);
        console.log("Resolver   :", resolverSigner);
        console.log("HouseEdge  :", edgeBps, "bps");
        console.log("HouseBank  :", houseFund / 1 ether, "SPRM");

        vm.stopBroadcast();
    }
}
