const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OracleRegistry", function () {
  async function deployOracleFixture() {
    const [owner, user] = await ethers.getSigners();

    const MockNFT = await ethers.getContractFactory("MockNFT");
    const nft = await MockNFT.deploy();
    await nft.waitForDeployment();

    const OracleRegistry = await ethers.getContractFactory("OracleRegistry");
    const oracle = await OracleRegistry.deploy(owner.address);
    await oracle.waitForDeployment();

    const specialTokenId = BigInt("0x0c06d6a17eb208a9bc7bd698eb6f22379209e3a4");
    const tokenIds = [specialTokenId, 2n, 3n];

    for (const tokenId of tokenIds) {
      await (await nft.mint(owner.address, tokenId)).wait();
    }

    await (await oracle.setTokenValue(specialTokenId, ethers.parseEther("12000000"))).wait();
    await (await oracle.setTokenValue(2, ethers.parseEther("18000000"))).wait();
    await (await oracle.setTokenValue(3, ethers.parseEther("22000000"))).wait();
    await (await oracle.setProvenance(specialTokenId, true)).wait();
    await (await oracle.setProvenance(2, true)).wait();
    await (await oracle.setProvenance(3, true)).wait();

    return { owner, user, nft, oracle, specialTokenId, tokenIds };
  }

  it("returns expected oracle values for three NFTs", async function () {
    const { oracle, specialTokenId } = await deployOracleFixture();

    expect(await oracle.getFloorValue(specialTokenId)).to.equal(ethers.parseEther("12000000"));
    expect(await oracle.getRiskStatus(specialTokenId)).to.equal(false);
    expect(await oracle.isTrademarkValid(specialTokenId)).to.equal(true);
    expect(await oracle.isProvenanceValid(specialTokenId)).to.equal(true);
    expect(await oracle.volatilityIndex()).to.equal(10);
  });

  it("updates panic mode when valuation or provenance becomes invalid", async function () {
    const { oracle, specialTokenId } = await deployOracleFixture();

    await expect(oracle.setTrademarkStatus(false)).to.emit(oracle, "TrademarkStatusUpdated");
    await expect(oracle.checkAndUpdatePanic(specialTokenId))
      .to.emit(oracle, "PanicTriggered")
      .withArgs(specialTokenId);

    expect(await oracle.tokenInPanic(specialTokenId)).to.equal(true);

    await expect(oracle.resolveTokenPanic(specialTokenId))
      .to.emit(oracle, "PanicResolved")
      .withArgs(specialTokenId);

    expect(await oracle.tokenInPanic(specialTokenId)).to.equal(false);
  });

  it("returns dynamic LTV tiers from volatility", async function () {
    const { oracle, specialTokenId } = await deployOracleFixture();

    await (await oracle.setVolatility(15)).wait();
    expect(await oracle.getDynamicMaxLTV(specialTokenId)).to.equal(7500);

    await (await oracle.setVolatility(45)).wait();
    expect(await oracle.getDynamicMaxLTV(specialTokenId)).to.equal(7000);

    await (await oracle.setVolatility(75)).wait();
    expect(await oracle.getDynamicMaxLTV(specialTokenId)).to.equal(6500);

    await (await oracle.setVolatility(90)).wait();
    expect(await oracle.getDynamicMaxLTV(specialTokenId)).to.equal(6000);
  });

  it("marks risk when value falls below minimum or provenance is missing", async function () {
    const { oracle, specialTokenId } = await deployOracleFixture();

    await (await oracle.setTokenValue(specialTokenId, ethers.parseEther("1000000"))).wait();
    expect(await oracle.getRiskStatus(specialTokenId)).to.equal(true);

    await (await oracle.setTokenValue(specialTokenId, ethers.parseEther("12000000"))).wait();
    await (await oracle.setProvenance(specialTokenId, false)).wait();
    expect(await oracle.getRiskStatus(specialTokenId)).to.equal(true);
  });
});
