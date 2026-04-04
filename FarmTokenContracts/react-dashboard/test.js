const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
const vault = new ethers.Contract('0x12A1B6B89B782F2b222BC13237C766f1E6A9e12C', ['event Staked(uint256[] tokenIds, uint256 timestamp)', 'function totalStaked() view returns (uint256)'], provider);

async function test() {
    try {
        const ts = await vault.totalStaked();
        console.log('Total Staked:', ts.toString());
        const logs = await vault.queryFilter(vault.filters.Staked());
        console.log('Logs:', logs.length);
    } catch (e) {
        console.error('Error:', e.message);
    }
}
test();
