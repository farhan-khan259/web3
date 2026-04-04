// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../BaseSetup.sol";

contract PrivateVaultUnitTest is BaseSetup {
    function test_Deploy_RevertIf_ZeroAddressNFT() public {
        vm.expectRevert("Invalid NFT");
        new PrivateNFTVault(address(0), address(pyt));
    }

    function test_Deploy_RevertIf_ZeroAddressRewardToken() public {
        vm.expectRevert("Invalid Yield Token");
        new PrivateNFTVault(address(mockNFT), address(0));
    }

    function test_SetRewardRate() public {
        uint256 newRate = 2 ether;
        vault.setRewardRate(newRate);
        assertEq(vault.rewardRatePerHour(), newRate);
    }

    function test_SetRewardRate_RevertIf_NotOwner() public {
        vm.prank(unauthorizedUser);
        vm.expectRevert();
        vault.setRewardRate(2 ether);
    }

    function test_PauseUnpause() public {
        vault.pause();
        assertTrue(vault.paused());

        vault.unpause();
        assertFalse(vault.paused());
    }

    function test_PauseUnpause_RevertIf_NotOwner() public {
        vm.prank(unauthorizedUser);
        vm.expectRevert();
        vault.pause();

        vm.prank(unauthorizedUser);
        vm.expectRevert();
        vault.unpause();
    }

    function test_BatchStake_RevertIf_NoTokens() public {
        uint256[] memory tokens = new uint256[](0);
        vm.expectRevert("No tokens provided");
        vault.batchStake(tokens);
    }

    function test_BatchStake_RevertIf_Paused() public {
        vault.pause();
        mockNFT.mintBatch(owner, 1);
        uint256[] memory tokens = new uint256[](1);
        tokens[0] = 1;

        vm.expectRevert();
        vault.batchStake(tokens);
    }

    function test_BatchStake_RevertIf_AlreadyStaked() public {
        mockNFT.mintBatch(owner, 1);
        uint256[] memory tokens = new uint256[](1);
        tokens[0] = 1;

        vault.batchStake(tokens);

        vm.expectRevert("Already staked");
        vault.batchStake(tokens);
    }

    function test_BatchStake_RevertIf_NotOwned() public {
        mockNFT.mintBatch(unauthorizedUser, 1);
        uint256[] memory tokens = new uint256[](1);
        tokens[0] = 1;

        vm.expectRevert("Must own NFT to stake");
        vault.batchStake(tokens); // Trying to stake someone else's NFT
    }

    function test_BatchUnstake_RevertIf_NoTokens() public {
        uint256[] memory tokens = new uint256[](0);
        vm.expectRevert("No tokens provided");
        vault.batchUnstake(tokens);
    }

    function test_BatchUnstake_RevertIf_MathError() public {
        mockNFT.mintBatch(owner, 1);
        uint256[] memory tokens = new uint256[](1);
        tokens[0] = 1;
        vault.batchStake(tokens);

        uint256[] memory unstakeTokens = new uint256[](2);
        unstakeTokens[0] = 1;
        unstakeTokens[1] = 2; // Extra token exceeding totalStaked

        vm.expectRevert("Critical math error");
        vault.batchUnstake(unstakeTokens);
    }

    function test_BatchUnstake_RevertIf_NotStakedOrOwned() public {
        mockNFT.mintBatch(owner, 2);
        uint256[] memory tokens = new uint256[](1);
        tokens[0] = 1; // Only stake 1

        vault.batchStake(tokens);

        uint256[] memory unstakeTokens = new uint256[](1);
        unstakeTokens[0] = 2; // Token 2 is not staked

        vm.expectRevert("Not owner/vaulted");
        vault.batchUnstake(unstakeTokens);
    }

    function test_EmergencyWithdraw_IgnoresNotStaked() public {
        mockNFT.mintBatch(owner, 1);
        uint256[] memory stakedTokens = new uint256[](1);
        stakedTokens[0] = 1;
        vault.batchStake(stakedTokens);

        uint256[] memory withdrawTokens = new uint256[](2);
        withdrawTokens[0] = 1;
        withdrawTokens[1] = 2; // token 2 not staked

        vault.emergencyWithdraw(withdrawTokens);
        assertEq(vault.totalStaked(), 0);
    }

    function test_ClaimRewards_RevertIf_NoRewards() public {
        vm.expectRevert("No rewards to claim");
        vault.claimRewards();
    }
}
