const hre = require("hardhat");
const { assert, expect } = require("chai");
const { ethers } = require("hardhat");

describe("CryptoMatV1", async function () {
  let deployer;
  let cryptomat;
  let notOwner;
  let dai;
  let stakingAmount;

  beforeEach(async function () {
    mintAmount = ethers.utils.parseEther("1");
    stakingAmount = ethers.utils.parseEther("0.0000001");

    [deployer, notOwner] = await hre.ethers.getSigners();

    // Create dai contract so we can test staking
    const DAI = await ethers.getContractFactory("DAI", deployer);
    dai = await DAI.deploy();
    await dai.deployed();
    dai.connect(deployer);

    await dai.mint(deployer.address, mintAmount);
    await dai.mint(notOwner.address, mintAmount);

    const CryptoMatV1 = await hre.ethers.getContractFactory(
      "CryptoMatV1",
      deployer
    );
    cryptomat = await CryptoMatV1.deploy(dai.address);
    await cryptomat.deployed();
    cryptomat.connect(deployer);

    await cryptomat.createCryptomat(
      [
        [3, 20, hre.ethers.utils.parseEther("0.1").toString(), "123"],
        [4, 10, hre.ethers.utils.parseEther("0.05").toString(), "1234"],
      ],
      210022,
      210022
    );

    await dai.approve(cryptomat.address, ethers.constants.MaxUint256);
    await dai
      .connect(notOwner)
      .approve(cryptomat.address, ethers.constants.MaxUint256);
  });

  describe("cryptomat", async function () {
    it("Can't create if the percentage doesn't add up to 100%", async function () {
      await expect(
        cryptomat.createCryptomat(
          [[5, 30, hre.ethers.utils.parseEther("0.1").toString(), "123"]],
          210022,
          210022
        )
      ).to.be.revertedWith("Summed percentage needs to add up to 100%");

      await expect(
        cryptomat.createCryptomat(
          [[3, 30, hre.ethers.utils.parseEther("0.1").toString(), "123"]],
          210022,
          210022
        )
      ).to.be.revertedWith("Summed percentage needs to add up to 100%");

      await expect(
        cryptomat.createCryptomat(
          [
            [4, 30, hre.ethers.utils.parseEther("0.1").toString(), "123"],
            [2, 25, hre.ethers.utils.parseEther("0.1").toString(), "123"],
          ],
          210022,
          210022
        )
      ).to.be.revertedWith("Summed percentage needs to add up to 100%");
    });

    it("Can't create if the msg.sender is not an owner", async () => {
      await expect(
        cryptomat.connect(notOwner).createCryptomat(
          [
            [4, 30, hre.ethers.utils.parseEther("0.1").toString(), "123"],
            [2, 25, hre.ethers.utils.parseEther("0.1").toString(), "123"],
          ],
          50,
          50
        )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Properly create all NFTs and arrays", async function () {
      const cryptomats = await cryptomat.cryptomats(0);
      const nftsToSell = await cryptomat.getAllNftsForAddress(
        cryptomat.address
      );
      const tokenId = await cryptomat._tokenId();

      assert.equal(nftsToSell.length, 7);
      assert.equal(cryptomats !== null, true);
      assert.equal(tokenId, 2);
    });

    it("Properly distribute the balance", async () => {
      await cryptomat.deposit(0, stakingAmount);

      const nfts = await cryptomat.getAllNftsForAddress(cryptomat.address);

      for (const nft of nfts) {
        const properBalance =
          (parseInt(stakingAmount) * parseInt(nft.percentage.toString())) / 100;

        assert.equal(properBalance, parseInt(nft.balance.toString()));
      }
    });

    describe("Properly buy NFT from primary market", async () => {
      it("Can't buy if the owner is not a contract", async () => {
        await cryptomat.buy(0);

        await expect(cryptomat.connect(notOwner).buy(0)).to.be.revertedWith(
          "This is a primary market buy function"
        );
      });

      it("Properly set arrays after successful purchase", async () => {
        let deployerOwnedNfts = await cryptomat.getAllNftsForAddress(
          deployer.address
        );
        let contractOwnerNfts = await cryptomat.getAllNftsForAddress(
          cryptomat.address
        );

        assert.equal(deployerOwnedNfts.length, 0);
        assert.equal(contractOwnerNfts.length, 7);

        await cryptomat.buy(0);

        deployerOwnedNfts = await cryptomat.getAllNftsForAddress(
          deployer.address
        );
        contractOwnerNfts = await cryptomat.getAllNftsForAddress(
          cryptomat.address
        );

        assert.equal(deployerOwnedNfts.length, 1);
        assert.equal(contractOwnerNfts.length, 6);

        const nft = await cryptomat.cryptomatNfts(0);

        assert.equal(nft.owner.toString(), deployer.address);
      });
    });
  });

  describe("Collect mechanism", async () => {
    beforeEach(async () => {
      await cryptomat.buy(0);
      await cryptomat.deposit(0, stakingAmount);
    });

    it("is NOT able to collect if he's not an owner", async () => {
      await expect(cryptomat.connect(notOwner).collect(0)).to.be.revertedWith(
        "Only owner can redeem reward"
      );
    });

    it("is NOT able to collect if the NFT is on cooldown", async () => {
      await cryptomat.collect(0);

      await expect(cryptomat.collect(0)).to.be.revertedWith(
        "Reward is still timelocked"
      );
    });

    it("is able to collect if NFT is ready to harvest and is the owner", async () => {
      let nft = await cryptomat.cryptomatNfts(0);
      let currentBalance = nft.balance.toString();

      assert.equal(currentBalance !== "0", true);

      await cryptomat.collect(0);

      nft = await cryptomat.cryptomatNfts(0);
      currentBalance = nft.balance.toString();

      assert.equal(currentBalance === "0", true);
    });

    it("is able to collect NFT and then do it for 2nd time after timelock is open again", async () => {
      let nft = await cryptomat.cryptomatNfts(0);
      let currentBalance = nft.balance.toString();

      assert.equal(currentBalance !== "0", true);

      await cryptomat.collect(0);

      nft = await cryptomat.cryptomatNfts(0);
      currentBalance = nft.balance.toString();

      assert.equal(currentBalance === "0", true);

      await cryptomat.deposit(0, stakingAmount);

      nft = await cryptomat.cryptomatNfts(0);
      currentBalance = nft.balance.toString();

      assert.equal(currentBalance !== "0", true);

      await expect(cryptomat.collect(0)).to.be.revertedWith(
        "Reward is still timelocked"
      );

      await hre.network.provider.send("evm_increaseTime", [60 * 60 * 24 * 28]); // move 28 days in time

      await cryptomat.collect(0);
    });
  });

  describe("Collect All Mechanism", async () => {
    beforeEach(async () => {
      await cryptomat.buy(0);
      await cryptomat.buy(1);
      await cryptomat.deposit(0, stakingAmount);
    });

    it("Can't collect because he's not an owner", async () => {
      await expect(
        cryptomat.connect(notOwner).collectAllForAddress(deployer.address)
      ).to.be.revertedWith("Only owner can redeem rewards");
    });

    it("Collect all properly with balance reset and timelock set", async () => {
      let deployerOwnedNfts = await cryptomat.getAllNftsForAddress(
        deployer.address
      );

      const summedBalance = deployerOwnedNfts.reduce((a, b) => {
        return a + parseInt(b.balance.toString());
      }, 0);

      assert.equal(summedBalance, 40000000000);

      await cryptomat.collectAllForAddress(deployer.address);

      deployerOwnedNfts = await cryptomat.getAllNftsForAddress(
        deployer.address
      );

      assert.equal(
        deployerOwnedNfts.every(
          (nft) =>
            nft.balance.toString() === "0" &&
            new Date(
              parseInt(deployerOwnedNfts[0].timelockEndTime.toString()) * 1000
            ) > new Date()
        ),
        true
      );
    });
  });
});
