const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    const signer = new ethers.Wallet('0xb707c5fc7b8a88faaf04e01eef1159eac006a544aecfedd81a670f83aa951ade', provider);
    const vault = new ethers.Contract('0x12A1B6B89B782F2b222BC13237C766f1E6A9e12C', [
        'function batchStake(uint256[] calldata tokenIds) external',
        'function owner() view returns (address)'
    ], signer);

    try {
        const tx = await vault.batchStake([20]);
        await tx.wait();
        console.log("Success");
    } catch (error) {
        console.error("Error during batchStake:", error);
    }
}

main();
