const { ethers } = require("ethers");
const fs = require("fs");

/**
 * Script for Offline Multisig Execution bypassing Ethereum's 30m block limits via batch transaction chunks.
 * This generates raw hex calldata you can securely export to a USB string and inject via 
 * your Air-Gapped Safe/Multisig via gnosis safe transaction builder.
 */

async function main() {
    console.log("=========================================");
    console.log("   OFFLINE MULTISIG PAYLOAD GENERATOR    ");
    console.log("=========================================\n");

    // The ABI specifically containing the function we are constructing offline
    const vaultAbi = [
        "function batchStake(uint256[] calldata tokenIds) external nonReentrant",
        "function batchUnstake(uint256[] calldata tokenIds) external nonReentrant"
    ];

    // Initialize ethers interface
    const iface = new ethers.Interface(vaultAbi);

    // Context: The client holds 3,500 NFTs in the Treasury multisig
    const TOTAL_NFTS = 3500;

    // 200 NFTs per transaction. ERC721 safeTransferFrom averages ~50,000 gas internally. 
    // 200 * 50k = ~10,000,000 gas. This keeps it safely well under the ~30M block limit per tx!
    const BATCH_SIZE = 200;

    // E.g., assume sequence of client owned tokens goes from ID 1 -> 3500 for demo
    // We logically distribute them sequentially
    let startId = 1;
    let batchNumber = 1;

    console.log(`Generating hex payloads to stake ${TOTAL_NFTS} NFTs...`);
    console.log(`Chunking into ${BATCH_SIZE} NFTs per transaction batch to prevent 'Out of Gas' errors.\n`);

    const outputLog = [];

    while (startId <= TOTAL_NFTS) {
        let chunkTokenIds = [];
        let endId = Math.min(startId + BATCH_SIZE - 1, TOTAL_NFTS);

        for (let i = startId; i <= endId; i++) {
            chunkTokenIds.push(i);
        }

        // Generate the strict Hexadecimal calldata to be transmitted physically
        const hexPayload = iface.encodeFunctionData("batchStake", [chunkTokenIds]);

        const logMsg = `[BATCH #${batchNumber}] | NFTs ${startId} -> ${endId} | Array Size: ${chunkTokenIds.length}\nPayload Data: ${hexPayload}\n`;
        console.log(logMsg);
        outputLog.push(logMsg);

        startId += BATCH_SIZE;
        batchNumber++;
    }

    // Optionally write securely to a local physical file to be transferred off-chain
    fs.writeFileSync("OFFLINE_PAYLOADS.txt", outputLog.join("\n"));
    console.log("✅ Successfully wrote all offline payloads to 'OFFLINE_PAYLOADS.txt' for USB transfer.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
