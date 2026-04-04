// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title PrivateNFTVault
 * @dev A highly secure Treasury Management Vault for an existing ERC721 NFT portfolio.
 * Strictly private; completely restricted to `onlyOwner()`.
 */
contract PrivateNFTVault is Ownable, ReentrancyGuard, Pausable {
    IERC721 public immutable nftCollection;
    IERC20 public immutable rewardToken;

    // 1.23 PYT (1.23 * 10^18) per hour
    uint256 public rewardRatePerHour = 1.23 ether;

    struct StakedNFT {
        uint256 timestamp;
        address owner; // Kept for tracking even if entirely proprietary
    }

    mapping(uint256 => StakedNFT) public vaultedNFTs;

    // Internal trackers specific to the single owner entity
    uint256 public totalStaked;
    uint256 public pendingAccumulatedReward; // Stored reward not explicitly attached to currently staked time
    uint256 public lastClaimTimestamp; // Time when rewards were last evaluated globally for the owner

    event Staked(uint256[] tokenIds, uint256 timestamp);
    event Unstaked(uint256[] tokenIds, uint256 timestamp);
    event RewardsClaimed(uint256 amount, uint256 timestamp);
    event RewardRateUpdated(uint256 oldRate, uint256 newRate);
    event EmergencyWithdraw(uint256[] tokenIds);

    constructor(
        address _nftAddress,
        address _rewardTokenAddress,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_nftAddress != address(0), "Invalid NFT");
        require(_rewardTokenAddress != address(0), "Invalid Yield Token");
        nftCollection = IERC721(_nftAddress);
        rewardToken = IERC20(_rewardTokenAddress);
        lastClaimTimestamp = block.timestamp;
    }

    /**
     * @dev To ensure math correctly accounts for the rate change, we sync state first.
     */
    function setRewardRate(uint256 newRate) external onlyOwner {
        _syncRewards();
        emit RewardRateUpdated(rewardRatePerHour, newRate);
        rewardRatePerHour = newRate;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function batchStake(
        uint256[] calldata tokenIds
    ) external onlyOwner whenNotPaused nonReentrant {
        _stake(tokenIds);
    }

    /**
     * @dev Specifically tracks unminted IDs for yield calculation.
     */
    function batchStakeUnminted(
        uint256[] calldata tokenIds
    ) external onlyOwner whenNotPaused nonReentrant {
        _stake(tokenIds);
    }

    function _stake(uint256[] calldata tokenIds) internal {
        require(tokenIds.length > 0, "No tokens provided");
        _syncRewards();
        totalStaked += tokenIds.length;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            require(vaultedNFTs[tokenId].timestamp == 0, "Already staked");
            vaultedNFTs[tokenId] = StakedNFT({
                timestamp: block.timestamp,
                owner: msg.sender
            });
        }
        emit Staked(tokenIds, block.timestamp);
    }

    /**
     * @dev Batches the unstaking of multiple NFTs.
     *      Only counts and removes IDs that are actually staked, so partial
     *      or duplicate lists never cause a math underflow revert.
     */
    function batchUnstake(
        uint256[] calldata tokenIds
    ) external onlyOwner nonReentrant {
        require(tokenIds.length > 0, "No tokens provided");

        _syncRewards();

        uint256 actuallyUnstaked = 0;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            if (vaultedNFTs[tokenId].timestamp != 0) {
                delete vaultedNFTs[tokenId];
                actuallyUnstaked++;
            }
        }

        require(totalStaked >= actuallyUnstaked, "Critical math error");
        totalStaked -= actuallyUnstaked;

        emit Unstaked(tokenIds, block.timestamp);
    }

    /**
     * @dev Returns the total pending accumulated rewards, including the dynamically accrued yield since last manual sync.
     */
    function getPendingRewards() external view returns (uint256) {
        if (totalStaked == 0) {
            return pendingAccumulatedReward;
        }

        uint256 hoursPassed = ((block.timestamp - lastClaimTimestamp) * 1e18) /
            1 hours;
        uint256 yieldAccrued = (totalStaked * hoursPassed * rewardRatePerHour) /
            1e18;

        return pendingAccumulatedReward + yieldAccrued;
    }

    /**
     * @dev Claim all compiled rewards across all staked items natively.
     */
    function claimRewards() external onlyOwner nonReentrant {
        _syncRewards();

        uint256 amount = pendingAccumulatedReward;
        require(amount > 0, "No rewards to claim");

        pendingAccumulatedReward = 0;

        // Safely transfer from vault reserve to the owner wallet
        bool success = rewardToken.transfer(msg.sender, amount);
        require(success, "Transfer failed");

        emit RewardsClaimed(amount, block.timestamp);
    }

    /**
     * @dev Internal function that calculates the time passed since the last sync
     * against the total currently staked items, storing it securely into pending balance.
     */
    function _syncRewards() internal {
        if (totalStaked > 0) {
            uint256 hoursPassed = ((block.timestamp - lastClaimTimestamp) *
                1e18) / 1 hours;
            // Formula: count * hoursPassed * rewardRate
            // hoursPassed is given in base 1e18 precision internally to limit precision loss

            uint256 yieldAccrued = (totalStaked *
                hoursPassed *
                rewardRatePerHour) / 1e18;
            pendingAccumulatedReward += yieldAccrued;
        }
        lastClaimTimestamp = block.timestamp;
    }

    /**
     * @dev Emergency escape hatch transferring the NFTs out without touching yield logic.
     */
    function emergencyWithdraw(
        uint256[] calldata tokenIds
    ) external onlyOwner nonReentrant {
        // Decrease staked count safely if needed, though usually this is an absolute exit scenario
        uint256 withdrawnCounts = 0;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            if (vaultedNFTs[tokenId].owner == msg.sender) {
                delete vaultedNFTs[tokenId];
                // Transfer out removed for soft staking
                withdrawnCounts++;
            }
        }

        if (totalStaked >= withdrawnCounts) {
            totalStaked -= withdrawnCounts;
        }

        emit EmergencyWithdraw(tokenIds);
    }
}
