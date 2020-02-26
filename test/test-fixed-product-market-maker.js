const { expectEvent } = require('openzeppelin-test-helpers')
const { getConditionId, getCollectionId, getPositionId } = require('@gnosis.pm/conditional-tokens-contracts/utils/id-helpers')(web3.utils)
const { randomHex, toBN } = web3.utils

const ConditionalTokens = artifacts.require('ConditionalTokens')
const WETH9 = artifacts.require('WETH9')
const FixedProductMarketMakerFactory = artifacts.require('FixedProductMarketMakerFactory')
const FixedProductMarketMaker = artifacts.require('FixedProductMarketMaker')

contract('FixedProductMarketMaker', function([, creator, oracle, investor1, trader, investor2]) {
    const questionId = randomHex(32)
    const numOutcomes = 64
    const conditionId = getConditionId(oracle, questionId, numOutcomes)
    const collectionIds = Array.from(
        { length: numOutcomes },
        (_, i) => getCollectionId(conditionId, toBN(1).shln(i))
    );

    let conditionalTokens
    let collateralToken
    let fixedProductMarketMakerFactory
    let positionIds
    before(async function() {
        conditionalTokens = await ConditionalTokens.deployed();
        collateralToken = await WETH9.deployed();
        fixedProductMarketMakerFactory = await FixedProductMarketMakerFactory.deployed()
        positionIds = collectionIds.map(collectionId => getPositionId(collateralToken.address, collectionId))
    })

    let fixedProductMarketMaker;
    const feeFactor = toBN(3e15) // (0.3%)
    step('can be created by factory', async function() {
        await conditionalTokens.prepareCondition(oracle, questionId, numOutcomes);
        const createArgs = [
            conditionalTokens.address,
            collateralToken.address,
            [conditionId],
            feeFactor,
            { from: creator }
        ]
        const fixedProductMarketMakerAddress = await fixedProductMarketMakerFactory.createFixedProductMarketMaker.call(...createArgs)
        const createTx = await fixedProductMarketMakerFactory.createFixedProductMarketMaker(...createArgs);
        expectEvent.inLogs(createTx.logs, 'FixedProductMarketMakerCreation', {
            creator,
            fixedProductMarketMaker: fixedProductMarketMakerAddress,
            conditionalTokens: conditionalTokens.address,
            collateralToken: collateralToken.address,
            // conditionIds: [conditionId],
            fee: feeFactor,
        });

        fixedProductMarketMaker = await FixedProductMarketMaker.at(fixedProductMarketMakerAddress)
    })

    const addedFunds1 = toBN(10e18)
    const initialDistribution = []
    const expectedFundedAmounts = new Array(64).fill(addedFunds1)
    step('can be funded', async function() {
        await collateralToken.deposit({ value: addedFunds1, from: investor1 });
        await collateralToken.approve(fixedProductMarketMaker.address, addedFunds1, { from: investor1 });
        const fundingTx = await fixedProductMarketMaker.addFunding(addedFunds1, initialDistribution, { from: investor1 });

        expectEvent.inLogs(fundingTx.logs, 'FPMMFundingAdded', {
            funder: investor1,
            // amountsAdded: expectedFundedAmounts,
            sharesMinted: addedFunds1,
        });
        const { amountsAdded } = fundingTx.logs.find(
            ({ event }) => event === 'FPMMFundingAdded'
        ).args;
        amountsAdded.should.have.lengthOf(expectedFundedAmounts.length);
        for (let i = 0; i < amountsAdded.length; i++) {
            amountsAdded[i].should.be.a.bignumber.equal(expectedFundedAmounts[i]);
        }

        (await collateralToken.balanceOf(investor1)).should.be.a.bignumber.equal("0");
        (await fixedProductMarketMaker.balanceOf(investor1)).should.be.a.bignumber.equal(addedFunds1);

        for(let i = 0; i < positionIds.length; i++) {
            (await conditionalTokens.balanceOf(fixedProductMarketMaker.address, positionIds[i]))
                .should.be.a.bignumber.equal(expectedFundedAmounts[i]);
            (await conditionalTokens.balanceOf(investor1, positionIds[i]))
                .should.be.a.bignumber.equal(addedFunds1.sub(expectedFundedAmounts[i]));
        }
    });

    let marketMakerPool;
    step('can buy tokens from it', async function() {
        const investmentAmount = toBN(1e18)
        const buyOutcomeIndex = 1;
        await collateralToken.deposit({ value: investmentAmount, from: trader });
        await collateralToken.approve(fixedProductMarketMaker.address, investmentAmount, { from: trader });

        const feeAmount = investmentAmount.mul(feeFactor).div(toBN(1e18));

        const outcomeTokensToBuy = await fixedProductMarketMaker.calcBuyAmount(investmentAmount, buyOutcomeIndex);

        await fixedProductMarketMaker.buy(investmentAmount, buyOutcomeIndex, outcomeTokensToBuy, { from: trader });

        (await collateralToken.balanceOf(trader)).should.be.a.bignumber.equal("0");
        (await fixedProductMarketMaker.balanceOf(trader)).should.be.a.bignumber.equal("0");

        marketMakerPool = []
        for(let i = 0; i < positionIds.length; i++) {
            let newMarketMakerBalance;
            if(i === buyOutcomeIndex) {
                newMarketMakerBalance = expectedFundedAmounts[i].add(investmentAmount).sub(feeAmount).sub(outcomeTokensToBuy);
                (await conditionalTokens.balanceOf(trader, positionIds[i]))
                    .should.be.a.bignumber.equal(outcomeTokensToBuy);
            } else {
                newMarketMakerBalance = expectedFundedAmounts[i].add(investmentAmount).sub(feeAmount);
                (await conditionalTokens.balanceOf(trader, positionIds[i]))
                    .should.be.a.bignumber.equal("0");
            }
            (await conditionalTokens.balanceOf(fixedProductMarketMaker.address, positionIds[i]))
                .should.be.a.bignumber.equal(newMarketMakerBalance);
            marketMakerPool[i] = newMarketMakerBalance
        }
    })

    step('can sell tokens to it', async function() {
        const returnAmount = toBN(5e17)
        const sellOutcomeIndex = 1;
        await conditionalTokens.setApprovalForAll(fixedProductMarketMaker.address, true, { from: trader });

        const feeAmount = returnAmount.mul(feeFactor).div(toBN(1e18).sub(feeFactor));

        const outcomeTokensToSell = await fixedProductMarketMaker.calcSellAmount(returnAmount, sellOutcomeIndex);

        await fixedProductMarketMaker.sell(returnAmount, sellOutcomeIndex, outcomeTokensToSell, { from: trader });

        (await collateralToken.balanceOf(trader)).should.be.a.bignumber.equal(returnAmount);
        (await fixedProductMarketMaker.balanceOf(trader)).should.be.a.bignumber.equal("0");

        for(let i = 0; i < positionIds.length; i++) {
            let newMarketMakerBalance;
            if(i === sellOutcomeIndex) {
                newMarketMakerBalance = marketMakerPool[i].sub(returnAmount).sub(feeAmount).add(outcomeTokensToSell)
            } else {
                newMarketMakerBalance = marketMakerPool[i].sub(returnAmount).sub(feeAmount)
            }
            (await conditionalTokens.balanceOf(fixedProductMarketMaker.address, positionIds[i]))
                .should.be.a.bignumber.equal(newMarketMakerBalance);
            marketMakerPool[i] = newMarketMakerBalance
        }
    })

    const addedFunds2 = toBN(5e18)
    step('can continue being funded', async function() {
        await collateralToken.deposit({ value: addedFunds2, from: investor2 });
        await collateralToken.approve(fixedProductMarketMaker.address, addedFunds2, { from: investor2 });
        await fixedProductMarketMaker.addFunding(addedFunds2, [], { from: investor2 });

        (await collateralToken.balanceOf(investor2)).should.be.a.bignumber.equal("0");
        (await fixedProductMarketMaker.balanceOf(investor2)).should.be.a.bignumber.gt("0");

        for(let i = 0; i < positionIds.length; i++) {
            let newMarketMakerBalance = await conditionalTokens.balanceOf(fixedProductMarketMaker.address, positionIds[i])
            newMarketMakerBalance.should.be.a.bignumber.gt(marketMakerPool[i]).lte(marketMakerPool[i].add(addedFunds2));
            marketMakerPool[i] = newMarketMakerBalance;

            (await conditionalTokens.balanceOf(investor2, positionIds[i]))
                .should.be.a.bignumber.gte("0").lt(addedFunds2);
        }
    });

    const burnedShares1 = toBN(5e18)
    step('can be defunded', async function() {
        await fixedProductMarketMaker.removeFunding(burnedShares1, { from: investor1 });

        (await collateralToken.balanceOf(investor1)).should.be.a.bignumber.gt("0");
        (await fixedProductMarketMaker.balanceOf(investor1)).should.be.a.bignumber.equal(addedFunds1.sub(burnedShares1));

        for(let i = 0; i < positionIds.length; i++) {
            let newMarketMakerBalance = await conditionalTokens.balanceOf(fixedProductMarketMaker.address, positionIds[i])
            newMarketMakerBalance.should.be.a.bignumber.lt(marketMakerPool[i]);
            (await conditionalTokens.balanceOf(investor1, positionIds[i]))
                .should.be.a.bignumber.equal(
                    addedFunds1
                        .sub(expectedFundedAmounts[i])
                        .add(marketMakerPool[i])
                        .sub(newMarketMakerBalance)
                );

            marketMakerPool[i] = newMarketMakerBalance;
        }
    })
})
