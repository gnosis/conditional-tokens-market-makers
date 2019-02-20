// const truffleAssert = require('truffle-assertions');
// const assert = require('chai').assert;
const rlp = require('rlp');
const { assertRejects, getParamFromTxEvent } = require("./utils");
const { toHex, padLeft, keccak256, asciiToHex, toBN, fromWei, toChecksumAddress } = web3.utils;
const { getBlockNumber } = web3.eth;

const PredictionMarketSystem = artifacts.require('PredictionMarketSystem');
const LMSRMarketMaker = artifacts.require('LMSRMarketMaker');
const LMSRMarketMakerFactory = artifacts.require('LMSRMarketMakerFactory');
const WETH9 = artifacts.require('WETH9');

contract("Multi-condition", function(accounts) {
    const funding = process.env.AMMFUNDING || toBN(1e17);
    const trader = 9;

    let pmSystem;
    let conditionOneOracle;
    let conditionTwoOracle;
    let collateralToken;
    let conditionOneId, conditionTwoId;
    let checksummedLMSRAddress;
    let lmsrInstance;
    let positionId1, positionId2, positionId3, positionId4;

    before(async () => {
        const investor = 0;
        const feeFactor = 0;

        const questionOneId = process.env.O1QUESTIONID || "0x0100000000000000000000000000000000000000000000000000000000000000"
        const questionTwoId = process.env.O2QUESTIONID || "0x0200000000000000000000000000000000000000000000000000000000000000"

        pmSystem = await PredictionMarketSystem.deployed();
        lmsrFactory = await LMSRMarketMakerFactory.deployed();
        collateralToken = await WETH9.deployed();

        conditionOneOracle = accounts[1]
        conditionTwoOracle = accounts[2]

        // Condition IDs
        await pmSystem.prepareCondition(conditionOneOracle, questionOneId, 2)
        await pmSystem.prepareCondition(conditionTwoOracle, questionTwoId, 2)
        
        conditionOneId = keccak256(conditionOneOracle + [questionOneId, 2].map(v => padLeft(toHex(v), 64).slice(2)).join(""));
        conditionTwoId = keccak256(conditionTwoOracle + [questionTwoId, 2].map(v => padLeft(toHex(v), 64).slice(2)).join(""));

        // LMSR Address
        checksummedLMSRAddress = toChecksumAddress(keccak256(rlp.encode([lmsrFactory.address, 0x01])).substr(26));
        await collateralToken.deposit({ value: funding, from: accounts[investor] })
        await collateralToken.approve(checksummedLMSRAddress, funding, { from: accounts[investor] }) 

        lmsrInstance = await getParamFromTxEvent(
            await lmsrFactory.createLMSRMarketMaker(pmSystem.address, collateralToken.address, [conditionOneId, conditionTwoId], feeFactor, funding,
                { from: accounts[investor] }),
                'lmsrMarketMaker', LMSRMarketMaker)

        // The pmSystem should have 4 positions equal to env.AMMFUNDING now
        const c1o1CollectionId = toBN(keccak256(
            conditionOneId + padLeft(toHex(0b01), 64).slice(2)
        ));
        const c1o2CollectionId = toBN(keccak256(
            conditionOneId + padLeft(toHex(0b10), 64).slice(2)
        ));
        const c2o1CollectionId = toBN(keccak256(
            conditionTwoId + padLeft(toHex(0b01), 64).slice(2)
        ));
        const c2o2CollectionId = toBN(keccak256(
            conditionTwoId + padLeft(toHex(0b10), 64).slice(2)
        ));

        positionId1 = keccak256(
            collateralToken.address + toHex(c1o1CollectionId.add(c2o1CollectionId)).slice(-64)
        );
        positionId2 = keccak256(
            collateralToken.address + toHex(c1o2CollectionId.add(c2o1CollectionId)).slice(-64)
        );
        positionId3 = keccak256(
            collateralToken.address + toHex(c1o1CollectionId.add(c2o2CollectionId)).slice(-64)
        );
        positionId4 = keccak256(
            collateralToken.address + toHex(c1o2CollectionId.add(c2o2CollectionId)).slice(-64)
        );
    });

    it("Should have conditions in the system with the listed ConditionIDs", async () => {
        // This reverts if the payoutNumerator would be invalid
        // So asserting 0 means that it has been created
        var numeratorLen = await pmSystem.payoutNumerators(conditionOneId, 0).then(r => r.toString());
        assert.equal(numeratorLen, 0);

        var numeratorLen2 = await pmSystem.payoutNumerators(conditionTwoId, 0).then(r => r.toString());
        assert.equal(numeratorLen2, 0);
    });

    it("Should have an LMSR deployed with the correct funding", async () => {
      assert(funding.eq(await lmsrInstance.funding()));
      assert.equal(await lmsrInstance.atomicOutcomeSlotCount(), 4);
    });

    it("The LMSR should have the correct amount of tokens at the specified positions", async () => {
        assert(funding.eq(await pmSystem.balanceOf(lmsrInstance.address, positionId1)));
        assert(funding.eq(await pmSystem.balanceOf(lmsrInstance.address, positionId2)));
        assert(funding.eq(await pmSystem.balanceOf(lmsrInstance.address, positionId3)));
        assert(funding.eq(await pmSystem.balanceOf(lmsrInstance.address, positionId4)));
    });

    it("Users should be able to buy a position", async () => {
        // Users should buy one of the AMMs positions.
        await collateralToken.deposit({ from: accounts[trader], value: toBN(1e18) });
        await collateralToken.approve(lmsrInstance.address, toBN(1e18), { from: accounts[trader] });

        await lmsrInstance.trade([1e9, 0, 1e9, 0], 0, false, { from: accounts[trader]});

        assert.equal(await pmSystem.balanceOf(accounts[trader], positionId1), 1e9);
        assert.equal(await pmSystem.balanceOf(accounts[trader], positionId2), 0);
        assert.equal(await pmSystem.balanceOf(accounts[trader], positionId3), 1e9);
        assert.equal(await pmSystem.balanceOf(accounts[trader], positionId4), 0);
    });

    it("Users should be able to make complex buy / sell orders", async () => {
        await pmSystem.setApprovalForAll(lmsrInstance.address, true, { from: accounts[trader] });
        await lmsrInstance.trade([-1e9, 0, -1e9, 0], toBN(1e18), false, { from: accounts[trader]});

        assert.equal(await pmSystem.balanceOf(accounts[trader], positionId1), 0);
        assert.equal(await pmSystem.balanceOf(accounts[trader], positionId2), 0);
        assert.equal(await pmSystem.balanceOf(accounts[trader], positionId3), 0);
        assert.equal(await pmSystem.balanceOf(accounts[trader], positionId4), 0);
    })
});
