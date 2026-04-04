// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../BaseSetup.sol";

contract PrivateVaultIntegrationTest is BaseSetup {
    function test_StakeAndAccrueYieldOverTime() public {
        mockNFT.mintBatch(owner, 10);
        uint256[] memory tokens = new uint256[](10);
        for (uint i = 0; i < 10; i++) tokens[i] = i + 1;

        vault.batchStake(tokens);

        // Advance 10 hours
        vm.warp(block.timestamp + 10 hours);

        // 10 items * 10 hours * 1.23 = 123 PYT
        uint256 startBal = pyt.balanceOf(owner);
        vault.claimRewards();
        uint256 endBal = pyt.balanceOf(owner);

        assertEq(endBal - startBal, 123 ether);
        assertEq(vault.pendingAccumulatedReward(), 0);
    }

    function test_StakeMultipleTimesBeforeClaim() public {
        // Stake 5 NFTs initially
        mockNFT.mintBatch(owner, 10);
        uint256[] memory batch1 = new uint256[](5);
        for (uint i = 0; i < 5; i++) batch1[i] = i + 1;

        vault.batchStake(batch1);

        // Advance 5 hours (5 items * 5 hours * 1.23 = 30.75 PYT)
        vm.warp(block.timestamp + 5 hours);

        // Stake 5 more NFTs
        uint256[] memory batch2 = new uint256[](5);
        for (uint i = 0; i < 5; i++) batch2[i] = i + 6;

        vault.batchStake(batch2); // Sync occurs here

        // Advance another 5 hours (10 items * 5 hours * 1.23 = 61.5 PYT)
        vm.warp(block.timestamp + 5 hours);

        uint256 startBal = pyt.balanceOf(owner);
        vault.claimRewards();
        uint256 endBal = pyt.balanceOf(owner);

        // Total Expected: 30.75 + 61.5 = 92.25
        assertEq(endBal - startBal, 92.25 ether);
    }

    function test_RateChangeAdjustsYieldCorrectly() public {
        mockNFT.mintBatch(owner, 5);
        uint256[] memory tokens = new uint256[](5);
        for (uint i = 0; i < 5; i++) tokens[i] = i + 1;

        vault.batchStake(tokens);

        // Advance 4 hours (5 * 4 * 1.23 = 24.6 PYT)
        vm.warp(block.timestamp + 4 hours);

        // Owner changes rate to 2 PYT per hour
        vault.setRewardRate(2 ether); // Sync occurs here

        // Advance 2 hours (5 * 2 * 2 = 20 PYT)
        vm.warp(block.timestamp + 2 hours);

        uint256 startBal = pyt.balanceOf(owner);
        vault.claimRewards();
        uint256 endBal = pyt.balanceOf(owner);

        // Expected: 24.6 + 20 = 44.6 PYT
        assertEq(endBal - startBal, 44.6 ether);
    }
}
