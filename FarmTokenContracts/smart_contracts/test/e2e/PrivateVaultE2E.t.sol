// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../BaseSetup.sol";

contract PrivateVaultE2ETest is BaseSetup {
    function test_FullLifecycle_E2E() public {
        // 1. Owner Mints NFTs
        mockNFT.mintBatch(owner, 20);
        uint256[] memory allTokens = new uint256[](20);
        for (uint i = 0; i < 20; i++) allTokens[i] = i + 1;

        // 2. Owner Stakes first half
        uint256[] memory batch1 = new uint256[](10);
        for (uint i = 0; i < 10; i++) batch1[i] = i + 1;
        vault.batchStake(batch1);

        assertEq(vault.totalStaked(), 10);

        // 3. Time passes
        vm.warp(block.timestamp + 24 hours);

        // 4. Owner Stakes second half
        uint256[] memory batch2 = new uint256[](10);
        for (uint i = 0; i < 10; i++) batch2[i] = i + 11;
        vault.batchStake(batch2);

        assertEq(vault.totalStaked(), 20);

        // 5. Time passes
        vm.warp(block.timestamp + 48 hours);

        // 6. Owner claims rewards (10 * 24 * 1.23) + (20 * 48 * 1.23)
        // 295.2 + 1180.8 = 1476
        uint256 startBal = pyt.balanceOf(owner);
        vault.claimRewards();
        uint256 claimBal1 = pyt.balanceOf(owner);

        assertEq(claimBal1 - startBal, 1476 ether);

        // 7. Owner alters rate to 10 PYT/hour
        vault.setRewardRate(10 ether);

        // 8. Time passes
        vm.warp(block.timestamp + 5 hours);

        // 9. Unstake half
        vault.batchUnstake(batch1);
        assertEq(vault.totalStaked(), 10);

        // 10. Time passes
        vm.warp(block.timestamp + 10 hours);

        // 11. Claim rewards again (20 * 5 * 10) + (10 * 10 * 10)
        // 1000 + 1000 = 2000
        vault.claimRewards();
        uint256 claimBal2 = pyt.balanceOf(owner);
        assertEq(claimBal2 - claimBal1, 2000 ether);

        // 12. Emergency withdraw the rest
        vault.emergencyWithdraw(batch2);
        assertEq(vault.totalStaked(), 0);

        // 13. Time passes - no more rewards since staking total is 0
        vm.warp(block.timestamp + 100 hours);
        vm.expectRevert("No rewards to claim");
        vault.claimRewards();
    }
}
