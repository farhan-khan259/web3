// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../BaseSetup.sol";

contract PYTUnitTest is BaseSetup {
    function test_PYT_MintedToOwner() public {
        // Balances are correctly verified against the deployment logic.
        assertEq(pyt.balanceOf(owner), 49_000_000 * 10 ** 18); // 50m minus 1m given to vault in setup
        assertEq(pyt.totalSupply(), 50_000_000 * 10 ** 18);
    }
}
