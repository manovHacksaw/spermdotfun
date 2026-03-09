// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SprmToken}  from "../src/SprmToken.sol";
import {SprmFaucet} from "../src/SprmFaucet.sol";
import {SprmGame}   from "../src/SprmGame.sol";

contract DeployVrf is Script {
    // Chainlink VRF v2.5 — Fuji
    address constant VRF_COORDINATOR = 0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE;
    bytes32 constant VRF_KEY_HASH    = 0xc799bd1e3bd4d1a41cd4968997a4e03dfd2a3c7c04b695881138580163f42887;

    function run() external {
        uint256 pk       = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address treasury       = vm.envOr("TREASURY_ADDRESS",  deployer);
        address resolverSigner = vm.envOr("RESOLVER_SIGNER",   deployer);
        uint16  edgeBps        = uint16(vm.envOr("HOUSE_EDGE_BPS",   uint256(200)));
        uint256 houseFund      = vm.envOr("HOUSE_BANK_FUND",   uint256(1_000_000 ether));
        uint256 vrfSubId       = vm.envUint("VRF_SUBSCRIPTION_ID"); // required

        vm.startBroadcast(pk);

        // Reuse existing token + faucet if set, otherwise deploy fresh
        SprmToken token;
        SprmFaucet faucet;
        address existingToken  = vm.envOr("EXISTING_TOKEN_ADDRESS",  address(0));
        address existingFaucet = vm.envOr("EXISTING_FAUCET_ADDRESS", address(0));

        if (existingToken != address(0)) {
            token  = SprmToken(existingToken);
            faucet = SprmFaucet(existingFaucet);
            console.log("Reusing SprmToken  :", address(token));
            console.log("Reusing SprmFaucet :", address(faucet));
        } else {
            token = new SprmToken(deployer);
            console.log("SprmToken  :", address(token));
            faucet = new SprmFaucet(address(token));
            token.grantRole(token.MINTER_ROLE(), address(faucet));
            console.log("SprmFaucet :", address(faucet));
        }

        SprmGame game = new SprmGame(
            address(token),
            treasury,
            resolverSigner,
            edgeBps,
            VRF_COORDINATOR,
            VRF_KEY_HASH,
            vrfSubId
        );

        // Seed house bank
        token.mint(deployer, houseFund);
        token.approve(address(game), houseFund);
        game.fundHouseBank(houseFund);

        console.log("SprmGame (VRF) :", address(game));
        console.log("VRF Sub ID     :", vrfSubId);
        console.log("Treasury       :", treasury);
        console.log("Resolver       :", resolverSigner);
        console.log("HouseEdge      :", edgeBps, "bps");
        console.log("HouseBank      :", houseFund / 1 ether, "SPRM");
        console.log("");
        console.log("NEXT STEP: add", address(game), "as a consumer on vrf.chain.link");

        vm.stopBroadcast();
    }
}
