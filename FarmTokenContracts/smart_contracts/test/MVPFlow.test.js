const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Institutional NFT Credit Engine MVP", function () {
  async function deployFixture() {
    const [admin, operator, reserve, user] = await ethers.getSigners();

    const MockNFT = await ethers.getContractFactory("MockNFT");
    const nft = await MockNFT.deploy();
    await nft.waitForDeployment();

    const OracleRegistry = await ethers.getContractFactory("OracleRegistry");
    const oracle = await OracleRegistry.deploy(admin.address);
    await oracle.waitForDeployment();

    const Vault = await ethers.getContractFactory("Vault");
    const vault = await Vault.deploy(await nft.getAddress(), admin.address);
    await vault.waitForDeployment();

    const LoanEngine = await ethers.getContractFactory("LoanEngine");
    const loan = await LoanEngine.deploy(
      await oracle.getAddress(),
      await vault.getAddress(),
      admin.address
    );
    await loan.waitForDeployment();

    const RevenueRouter = await ethers.getContractFactory("RevenueRouter");
    const router = await RevenueRouter.deploy(
      await loan.getAddress(),
      admin.address,
      reserve.address
    );
    await router.waitForDeployment();

    await (await vault.setLoanEngine(await loan.getAddress())).wait();
    await (await vault.setOracle(await oracle.getAddress())).wait();
    await (await loan.setRevenueRouter(await router.getAddress())).wait();

    const OPERATOR_ROLE = await loan.OPERATOR_ROLE();
    await (await loan.grantRole(OPERATOR_ROLE, operator.address)).wait();
    const ROUTER_OPERATOR_ROLE = await router.OPERATOR_ROLE();
    await (await router.grantRole(ROUTER_OPERATOR_ROLE, operator.address)).wait();

    await (await nft.mint(admin.address, 1)).wait();
    await (await oracle.setTokenValue(1, ethers.parseEther("20"))).wait();
    await (await oracle.setProvenance(1, true)).wait();
    await (await oracle.setTrademarkStatus(true)).wait();
    await (await oracle.setVolatility(10)).wait();
    await (await nft.approve(await vault.getAddress(), 1)).wait();
    await (await vault.depositNFT(1)).wait();

    await admin.sendTransaction({
      to: await loan.getAddress(),
      value: ethers.parseEther("50"),
    });

    await (await router.setBeneficiary(1, user.address)).wait();

    return { admin, operator, reserve, user, oracle, vault, loan, router };
  }

  it("calculates dynamic max LTV tiers", async function () {
    const { oracle, loan } = await deployFixture();

    await (await oracle.setVolatility(15)).wait();
    expect(await loan.getDynamicMaxLTV()).to.equal(7500);

    await (await oracle.setVolatility(45)).wait();
    expect(await loan.getDynamicMaxLTV()).to.equal(7000);

    await (await oracle.setVolatility(75)).wait();
    expect(await loan.getDynamicMaxLTV()).to.equal(6500);

    await (await oracle.setVolatility(90)).wait();
    expect(await loan.getDynamicMaxLTV()).to.equal(6000);
  });

  it("enforces LTV cap on borrow and updates debt", async function () {
    const { operator, loan } = await deployFixture();

    await expect(
      loan.connect(operator).borrow(1, ethers.parseEther("16"))
    ).to.be.revertedWith("LTV cap exceeded");

    await expect(loan.connect(operator).borrow(1, ethers.parseEther("10")))
      .to.emit(loan, "Borrow")
      .withArgs(1, ethers.parseEther("10"));

    const position = await loan.positions(1);
    expect(position.debt).to.equal(ethers.parseEther("10"));
  });

  it("triggers panic when oracle reports risk", async function () {
    const { loan, oracle } = await deployFixture();

    await (await oracle.setProvenance(1, false)).wait();

    await expect(loan.checkAndUpdatePanic(1)).to.emit(loan, "PanicTriggered").withArgs(1);
    const position = await loan.positions(1);
    expect(position.inPanic).to.equal(true);
  });

  it("routes revenue with 70% debt and 30% beneficiary in normal mode", async function () {
    const { operator, user, loan, router } = await deployFixture();

    await (await loan.connect(operator).borrow(1, ethers.parseEther("5"))).wait();

    const userBefore = await ethers.provider.getBalance(user.address);

    await expect(
      router.connect(operator).depositRevenue(1, { value: ethers.parseEther("2") })
    )
      .to.emit(router, "RevenueProcessed")
      .withArgs(1, ethers.parseEther("2"));

    const userAfter = await ethers.provider.getBalance(user.address);
    const debtAfter = await loan.outstandingDebt(1);

    expect(debtAfter).to.equal(ethers.parseEther("3.6"));
    expect(userAfter - userBefore).to.equal(ethers.parseEther("0.6"));
  });
});