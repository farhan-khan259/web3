// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

contract FundScript is Script {
    function run() external {
        // Default Anvil Account 0
        uint256 defaultKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

        vm.startBroadcast(defaultKey);

        // The user's wallet
        address target = 0x7ef1CE1377A493794c52bE47580987Aa7453189A;

        (bool success, ) = target.call{value: 10 ether}("");
        require(success, "Funding failed");

        vm.stopBroadcast();
    }
}
