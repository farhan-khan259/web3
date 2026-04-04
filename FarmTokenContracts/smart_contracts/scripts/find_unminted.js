const { ethers } = require('ethers');
const fs = require('fs');

/**
 * SCRIPT CONFIGURATION
 */
const RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com"; // Change to your target RPC
const NFT_ADDRESS = "0x..."; // THE EXISTING NFT CONTRACT ADDRESS
const START_ID = 1;
const END_ID = 1000; // Check the first 1000 IDs

// Minimal ABI to check ownerOf
const ABI = [
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function totalSupply() view returns (uint256)"
];

async function main() {
    console.log(`--- Checking Unminted NFTs ---`);
    console.log(`Target Address: ${NFT_ADDRESS}`);
    console.log(`Range: ${START_ID} to ${END_ID}`);

    if (NFT_ADDRESS === "0x...") {
        console.error("Please update the NFT_ADDRESS in the script first!");
        return;
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const nftContract = new ethers.Contract(NFT_ADDRESS, ABI, provider);

    const unminted = [];
    const batchSize = 50; // Check 50 at a time to be kind to the RPC

    for (let i = START_ID; i <= END_ID; i += batchSize) {
        const currentBatchEnd = Math.min(i + batchSize - 1, END_ID);
        console.log(`Checking IDs ${i} to ${currentBatchEnd}...`);
        
        const promises = [];
        for (let j = i; j <= currentBatchEnd; j++) {
            promises.push(
                nftContract.ownerOf(j).catch(err => {
                    // ERC721 ownerOf reverts if the token doesn't exist (i.e., not minted)
                    // We look for revert signatures usually containing "invalid token ID" or similar
                    return null; 
                })
            );
        }

        const results = await Promise.all(promises);
        results.forEach((res, index) => {
            if (res === null) {
                unminted.push(i + index);
            }
        });
    }

    console.log(`\n--- Results ---`);
    console.log(`Total IDs checked: ${END_ID - START_ID + 1}`);
    console.log(`Total unminted found: ${unminted.length}`);
    
    if (unminted.length > 0) {
        fs.writeFileSync('unminted_nfts.txt', unminted.join(', '));
        console.log(`List of ID saved to 'unminted_nfts.txt'`);
        if (unminted.length < 50) {
            console.log(`IDs: ${unminted.join(', ')}`);
        }
    } else {
        console.log("No unminted IDs found in this range.");
    }
}

main().catch(console.error);
