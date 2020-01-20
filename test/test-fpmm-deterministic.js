const { expectEvent } = require('openzeppelin-test-helpers')
const { getConditionId, getCollectionId, getPositionId } = require('@gnosis.pm/conditional-tokens-contracts/utils/id-helpers')(web3.utils)
const { randomHex, toBN } = web3.utils

const ConditionalTokens = artifacts.require('ConditionalTokens')
const WETH9 = artifacts.require('WETH9')
const FPMMDeterministicFactory = artifacts.require('FPMMDeterministicFactory')
const FixedProductMarketMaker = artifacts.require('FixedProductMarketMaker')

contract('FPMMDeterministicFactory', function([, creator, oracle, trader, investor2]) {
    const questionId = randomHex(32)
    const numOutcomes = 10
    const conditionId = getConditionId(oracle, questionId, numOutcomes)
    const collectionIds = Array.from(
        { length: numOutcomes },
        (_, i) => getCollectionId(conditionId, toBN(1).shln(i))
    );

    let conditionalTokens
    let collateralToken
    let fpmmDeterministicFactory
    let positionIds
    before(async function() {
        conditionalTokens = await ConditionalTokens.deployed();
        collateralToken = await WETH9.deployed();
        fpmmDeterministicFactory = await FPMMDeterministicFactory.deployed()
        positionIds = collectionIds.map(collectionId => getPositionId(collateralToken.address, collectionId))
    })

    let fixedProductMarketMaker;
    const saltNonce = toBN(2020)
    const feeFactor = toBN(3e15) // (0.3%)
    const initialFunds = toBN(10e18)
    const initialDistribution = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
    const expectedFundedAmounts = initialDistribution.map(n => toBN(1e18 * n))

    step('can be created and funded by factory', async function() {
        await collateralToken.deposit({ value: initialFunds, from: creator });
        await collateralToken.approve(fpmmDeterministicFactory.address, initialFunds, { from: creator });

        await conditionalTokens.prepareCondition(oracle, questionId, numOutcomes);
        const createArgs = [
            saltNonce,
            conditionalTokens.address,
            collateralToken.address,
            [conditionId],
            feeFactor,
            initialFunds,
            initialDistribution,
            { from: creator }
        ]
        const fixedProductMarketMakerAddress = await fpmmDeterministicFactory.create2FixedProductMarketMaker.call(...createArgs)

        // TODO: somehow abstract this deterministic address calculation into a utility function
        fixedProductMarketMakerAddress.should.be.equal(
            web3.utils.toChecksumAddress(`0x${web3.utils.soliditySha3(
                { t: 'bytes', v: '0xff' },
                { t: 'address', v: fpmmDeterministicFactory.address },
                {
                    t: 'bytes32',
                    v: web3.utils.keccak256(web3.eth.abi.encodeParameters(
                        ['address', 'uint'],
                        [creator, saltNonce.toString()]
                    )),
                },
                {
                    t: 'bytes32',
                    v: web3.utils.keccak256(`0x3d3d606380380380913d393d73${
                        fpmmDeterministicFactory.address.replace(/^0x/, '')
                    }5af4602a57600080fd5b602d8060366000396000f3363d3d373d3d3d363d73${
                        (await fpmmDeterministicFactory.implementationMaster()).replace(/^0x/, '')
                    }5af43d82803e903d91602b57fd5bf3${
                        web3.eth.abi.encodeFunctionCall({
                            name: 'cloneConstructor',
                            type: 'function',
                            inputs: [{
                                type: 'bytes',
                                name: 'data',
                            }],
                        }, [web3.eth.abi.encodeParameters([
                            'address',
                            'address',
                            'bytes32[]',
                            'uint',
                        ], [
                            conditionalTokens.address,
                            collateralToken.address,
                            [conditionId],
                            feeFactor.toString(),
                        ])]).replace(/^0x/, '')
                    }`),
                },
            ).slice(-40)}`)
        )

        const createTx = await fpmmDeterministicFactory.create2FixedProductMarketMaker(...createArgs);
        expectEvent.inLogs(createTx.logs, 'FixedProductMarketMakerCreation', {
            creator,
            fixedProductMarketMaker: fixedProductMarketMakerAddress,
            conditionalTokens: conditionalTokens.address,
            collateralToken: collateralToken.address,
            // conditionIds: [conditionId],
            fee: feeFactor,
        });

        fixedProductMarketMaker = await FixedProductMarketMaker.at(fixedProductMarketMakerAddress);

        (await collateralToken.balanceOf(creator)).should.be.a.bignumber.equal("0");
        (await fixedProductMarketMaker.balanceOf(creator)).should.be.a.bignumber.equal(initialFunds);

        for(let i = 0; i < positionIds.length; i++) {
            (await conditionalTokens.balanceOf(fixedProductMarketMaker.address, positionIds[i]))
                .should.be.a.bignumber.equal(expectedFundedAmounts[i]);
            (await conditionalTokens.balanceOf(creator, positionIds[i]))
                .should.be.a.bignumber.equal(initialFunds.sub(expectedFundedAmounts[i]));
        }
    });

    let marketMakerPool;
    step('can buy tokens from it', async function() {
        const investmentAmount = toBN(1e18)
        const buyOutcomeIndex = 1;
        await collateralToken.deposit({ value: investmentAmount, from: trader });
        await collateralToken.approve(fixedProductMarketMaker.address, investmentAmount, { from: trader });

        const outcomeTokensToBuy = await fixedProductMarketMaker.calcBuyAmount(investmentAmount, buyOutcomeIndex);

        await fixedProductMarketMaker.buy(investmentAmount, buyOutcomeIndex, outcomeTokensToBuy, { from: trader });

        (await collateralToken.balanceOf(trader)).should.be.a.bignumber.equal("0");
        (await fixedProductMarketMaker.balanceOf(trader)).should.be.a.bignumber.equal("0");

        marketMakerPool = []
        for(let i = 0; i < positionIds.length; i++) {
            let newMarketMakerBalance;
            if(i === buyOutcomeIndex) {
                newMarketMakerBalance = expectedFundedAmounts[i].add(investmentAmount).sub(outcomeTokensToBuy);
                (await conditionalTokens.balanceOf(trader, positionIds[i]))
                    .should.be.a.bignumber.equal(outcomeTokensToBuy);
            } else {
                newMarketMakerBalance = expectedFundedAmounts[i].add(investmentAmount);
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

        const outcomeTokensToSell = await fixedProductMarketMaker.calcSellAmount(returnAmount, sellOutcomeIndex);

        await fixedProductMarketMaker.sell(returnAmount, sellOutcomeIndex, outcomeTokensToSell, { from: trader });

        (await collateralToken.balanceOf(trader)).should.be.a.bignumber.equal(returnAmount);
        (await fixedProductMarketMaker.balanceOf(trader)).should.be.a.bignumber.equal("0");

        for(let i = 0; i < positionIds.length; i++) {
            let newMarketMakerBalance;
            if(i === sellOutcomeIndex) {
                newMarketMakerBalance = marketMakerPool[i].sub(returnAmount).add(outcomeTokensToSell)
            } else {
                newMarketMakerBalance = marketMakerPool[i].sub(returnAmount)
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
        await fixedProductMarketMaker.removeFunding(burnedShares1, { from: creator });

        (await collateralToken.balanceOf(creator)).should.be.a.bignumber.equal("0");
        (await fixedProductMarketMaker.balanceOf(creator)).should.be.a.bignumber.equal(initialFunds.sub(burnedShares1));

        for(let i = 0; i < positionIds.length; i++) {
            let newMarketMakerBalance = await conditionalTokens.balanceOf(fixedProductMarketMaker.address, positionIds[i])
            newMarketMakerBalance.should.be.a.bignumber.lt(marketMakerPool[i]);
            (await conditionalTokens.balanceOf(creator, positionIds[i]))
                .should.be.a.bignumber.equal(
                    initialFunds
                        .sub(expectedFundedAmounts[i])
                        .add(marketMakerPool[i])
                        .sub(newMarketMakerBalance)
                );

            marketMakerPool[i] = newMarketMakerBalance;
        }
    })
})
