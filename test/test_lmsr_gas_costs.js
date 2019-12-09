const { expectEvent, constants: { MAX_UINT256 } } = require("openzeppelin-test-helpers");
const { getParamFromTxEvent } = require("./utils");

const {
    getConditionId,
} = require('@gnosis.pm/conditional-tokens-contracts/utils/id-helpers')(web3.utils)

const { toBN, randomHex } = web3.utils;

const ConditionalTokens = artifacts.require('ConditionalTokens');
const LMSRMarketMaker = artifacts.require('LMSRMarketMaker');
const LMSRMarketMakerFactory = artifacts.require('LMSRMarketMakerFactory');
const WETH9 = artifacts.require('WETH9');
const Whitelist = artifacts.require('Whitelist');

contract("LMSR gas costs", function([lmsrOwner, oracle, trader]) {
    const totalCollateralAvailable = toBN(1e19)

    let conditionalTokens;
    let lmsrMarketMakerFactory;
    let collateralToken;
    let whitelist;

    before(async function() {
        conditionalTokens = await ConditionalTokens.deployed();
        lmsrMarketMakerFactory = await LMSRMarketMakerFactory.deployed();
        collateralToken = await WETH9.deployed();
        whitelist = await Whitelist.deployed();

        await collateralToken.deposit({ value: totalCollateralAvailable, from: lmsrOwner })
        await collateralToken.approve(lmsrMarketMakerFactory.address, MAX_UINT256, { from: lmsrOwner });

        await collateralToken.deposit({ value: totalCollateralAvailable, from: trader })
    });

    function shouldBeCreatedAndLiquid(numConditions, outcomesPerCondition) {
        const funding = toBN(1e17);
        const feeFactor = toBN(0);

        context(`with ${numConditions} conditions and ${outcomesPerCondition} outcomes per condition`, function() {
            const conditions = []
            it('preparing conditions', async function() {
                for(let i = 0; i < numConditions; i++) {
                    const questionId = randomHex(32);
                    await conditionalTokens.prepareCondition(oracle, questionId, outcomesPerCondition)
                    conditions.push(getConditionId(oracle, questionId, outcomesPerCondition))
                }
                conditions.length.should.equal(numConditions);
            });

            let lmsrMarketMaker;
            it('creating the LMSR market maker', async function() {
                const tx = await lmsrMarketMakerFactory.createLMSRMarketMaker(
                    conditionalTokens.address,
                    collateralToken.address,
                    conditions,
                    feeFactor,
                    whitelist.address,
                    funding,
                    { from: lmsrOwner }
                );
                expectEvent.inLogs(tx.logs, "LMSRMarketMakerCreation", {
                    creator: lmsrOwner,
                    pmSystem: conditionalTokens.address,
                    collateralToken: collateralToken.address,
                    // conditionIds: conditions,
                    fee: feeFactor,
                    funding: funding,
                });
                lmsrMarketMaker = await getParamFromTxEvent(tx, 'lmsrMarketMaker', LMSRMarketMaker, 'LMSRMarketMakerCreation')
            });

            it('approving LMSR for trading', async function() {
                await collateralToken.approve(lmsrMarketMaker.address, MAX_UINT256, { from: trader });
                await conditionalTokens.setApprovalForAll(lmsrMarketMaker.address, true, { from: trader });
            });

            it('buying tokens', async function() {
                const buyAmounts = Array.from(
                    { length: outcomesPerCondition ** numConditions },
                    (_, i) => i % 2 ? toBN(0) : toBN(1e16)
                )

                await lmsrMarketMaker.trade(buyAmounts, 0, { from: trader });
            });

            it('selling tokens', async function() {
                const sellAmounts = Array.from(
                    { length: outcomesPerCondition ** numConditions },
                    (_, i) => i % 2 ? toBN(0) : toBN(-5e15)
                )

                await lmsrMarketMaker.trade(sellAmounts, 0, { from: trader });
            });
        });
    }

    shouldBeCreatedAndLiquid(1, 2);
    shouldBeCreatedAndLiquid(1, 3);
    shouldBeCreatedAndLiquid(1, 4);
    shouldBeCreatedAndLiquid(1, 10);
    // shouldBeCreatedAndLiquid(1, 73);
    shouldBeCreatedAndLiquid(2, 2);
    shouldBeCreatedAndLiquid(2, 3);
    shouldBeCreatedAndLiquid(2, 4);
    // shouldBeCreatedAndLiquid(2, 7);
    shouldBeCreatedAndLiquid(3, 2);
    shouldBeCreatedAndLiquid(3, 3);
    shouldBeCreatedAndLiquid(4, 2);
});
