const _ = require('lodash')
const { getCollectionId, getPositionId } = require('@gnosis.pm/conditional-tokens-contracts/utils/id-helpers')(web3.utils)
const utils = require('./utils')
const { ONE, isClose, lmsrMarginalPrice, getParamFromTxEvent, assertRejects, Decimal, randnums } = utils
const { toBN, toHex } = web3.utils

const ConditionalTokens = artifacts.require('ConditionalTokens')
const LMSRMarketMakerFactory = artifacts.require('LMSRMarketMakerFactory')
const LMSRMarketMaker = artifacts.require('LMSRMarketMaker')
const Whitelist = artifacts.require('Whitelist')
const WETH9 = artifacts.require('WETH9')

contract('MarketMaker', function(accounts) {
    let pmSystem
    let lmsrMarketMakerFactory
    let etherToken
    let whitelist
    
    beforeEach(async () => {
        pmSystem = await ConditionalTokens.deployed()
        lmsrMarketMakerFactory = await LMSRMarketMakerFactory.deployed()
        etherToken = await WETH9.deployed()
        whitelist = { address: `0x${'0'.repeat(40)}` }
    })
    
    it('should move price of an outcome to 0 after participants sell lots of that outcome to lmsrMarketMaker maker', async () => {
        // Create event
        const numOutcomes = 2
        const netOutcomeTokensSold = new Array(numOutcomes).fill(0)
        const questionId = '0xf00dcafef00dcafef00dcafef00dcafef00dcafef00dcafef00dcafef00dcafe'
        const oracleAddress = accounts[1]

        
        const conditionId = await getParamFromTxEvent(
            await pmSystem.prepareCondition(oracleAddress, questionId, numOutcomes),
            'conditionId')

            const investor = 0
            const feeFactor = 0  // 0%
     
        // Create and fund lmsrMarketMaker
        const funding = toBN(1e17)
        await etherToken.deposit({ value: funding, from: accounts[investor] })
        await etherToken.approve(lmsrMarketMakerFactory.address, funding, { from: accounts[investor] })
        assert.equal(await etherToken.balanceOf.call(accounts[investor]).then(v => v.toString()), funding.toString())
        const lmsrMarketMaker = await getParamFromTxEvent(
            await lmsrMarketMakerFactory.createLMSRMarketMaker(pmSystem.address, etherToken.address, [conditionId], feeFactor, whitelist.address, toBN(1e17),
                { from: accounts[investor] }),
                'lmsrMarketMaker', LMSRMarketMaker, 'LMSRMarketMakerCreation')
        assert.equal(await etherToken.balanceOf.call(accounts[investor]).then(v => v.toString()), '0')
        
        // User buys all outcomes
        const trader = 1
        const outcome = 1
        const tokenCountRaw = 1e18
        const tokenCount = toBN(tokenCountRaw)
        const loopCount = toBN(10)

        await etherToken.deposit({ value: tokenCount.mul(loopCount), from: accounts[trader] })
        await etherToken.approve(pmSystem.address, tokenCount.mul(loopCount), { from: accounts[trader] })
        await pmSystem.splitPosition(etherToken.address, "0x00", conditionId, [...Array(numOutcomes).keys()].map(i => 1 << i), tokenCount.mul(loopCount), { from: accounts[trader] })
        await pmSystem.setApprovalForAll(lmsrMarketMaker.address, true, { from: accounts[trader] })

        // User sells tokens
        const buyerBalance = await etherToken.balanceOf.call(accounts[trader])
        let profit, outcomeTokenAmounts
        for(const i of _.range(loopCount.toNumber())) {
            // Calculate profit for selling tokens
            outcomeTokenAmounts = Array.from({length: numOutcomes}, (v, i) => i === outcome ? tokenCount.neg() : toBN(0))
            profit = (await lmsrMarketMaker.calcNetCost.call(outcomeTokenAmounts)).neg()
            if(profit.eqn(0))
                break

            // Selling tokens
            assert.equal((await getParamFromTxEvent(
                await lmsrMarketMaker.trade(outcomeTokenAmounts, profit.neg(), { from: accounts[trader] }), 'outcomeTokenNetCost'
            )).neg().toString(), profit.toString())

            netOutcomeTokensSold[outcome] -= tokenCountRaw
            const expected = lmsrMarginalPrice(funding, netOutcomeTokensSold, outcome)
            const actual = new Decimal(await lmsrMarketMaker.calcMarginalPrice.call(toBN(outcome)).then(v => v.toString())).div(ONE)
            assert(
                isClose(actual, expected),
                `Marginal price calculation is off for iteration ${i}:\n` +
                `        funding: ${funding}\n` +
                `        net outcome tokens sold: ${netOutcomeTokensSold}\n` +
                `        actual: ${actual}\n` +
                `        expected: ${expected}`
            )
        }
        // Selling of tokens is worth less than 1 Wei
        assert.equal(profit, 0)
        // User's Ether balance increased
        assert((await etherToken.balanceOf.call(accounts[trader])).gt(buyerBalance), 'trader balance did not increase')
    })

    it('should move price of an outcome to 1 after participants buy lots of that outcome from lmsrMarketMaker maker', async () => {
        // Prepare condition
        const numOutcomes = 2
        const questionId = '0xf00dcafef00dcafef00dcafef00dcafef00dcafef00dcafef00dcafef00dcafe'
        const oracleAddress = accounts[5]
        const conditionId = await getParamFromTxEvent(
            await pmSystem.prepareCondition(oracleAddress, questionId, toBN(numOutcomes)),
            'conditionId')
        
            for(const [investor, funding, tokenCountRaw] of [
                [2, toBN(1e17), 1e18],
                [3, toBN(1), 10],
                [4, toBN(1), 1e18],
            ]) {
            await etherToken.deposit({ value: funding, from: accounts[investor] })
            await etherToken.approve(lmsrMarketMakerFactory.address, funding, { from: accounts[investor] })
            
            const tokenCount = toBN(tokenCountRaw)
            const netOutcomeTokensSold = new Array(numOutcomes).fill(0)
            
            // Create and Fund lmsrMarketMaker

            assert.equal(await etherToken.balanceOf.call(accounts[investor]).then(v => v.toString()), funding.toString())
            const feeFactor = 0  // 0%
            const lmsrMarketMaker = await getParamFromTxEvent(
                await lmsrMarketMakerFactory.createLMSRMarketMaker(pmSystem.address, etherToken.address, [conditionId], feeFactor, whitelist.address, funding,
                    { from: accounts[investor] }),
                'lmsrMarketMaker', LMSRMarketMaker, 'LMSRMarketMakerCreation')
            assert.equal(await etherToken.balanceOf.call(accounts[investor]).then(v => v.toString()), '0')

            // User buys ether tokens
            const trader = 1
            const outcome = 1
            const loopCount = 10
            await etherToken.deposit({ value: tokenCount.muln(loopCount), from: accounts[trader] })

            // User buys outcome tokens from lmsrMarketMaker maker
            let cost, outcomeTokenAmounts
            for(const i of _.range(loopCount)) {
                // Calculate cost of buying tokens
                outcomeTokenAmounts = Array.from({length: numOutcomes}, (v, i) => i === outcome ? tokenCount : toBN(0))
                cost = await lmsrMarketMaker.calcNetCost.call(outcomeTokenAmounts)

                // Buying tokens
                await etherToken.approve(lmsrMarketMaker.address, cost, { from: accounts[trader] })
                assert.equal(await getParamFromTxEvent(
                    await lmsrMarketMaker.trade(outcomeTokenAmounts, cost, { from: accounts[trader] }), 'outcomeTokenNetCost'
                ).then(v => v.toString()), cost.toString())

                netOutcomeTokensSold[outcome] += tokenCountRaw
                const expected = lmsrMarginalPrice(funding, netOutcomeTokensSold, outcome)
                const actual = new Decimal(await lmsrMarketMaker.calcMarginalPrice.call(toBN(outcome)).then(v => v.toString())).div(ONE)
                assert(
                    isClose(actual, expected) || expected.toString() == 'NaN',
                    `Marginal price calculation is off for iteration ${i}:\n` +
                    `        funding: ${funding}\n` +
                    `        net outcome tokens sold: ${netOutcomeTokensSold}\n` +
                    `        actual: ${actual}\n` +
                    `        expected: ${expected}`
                )
            }

            // Price is at least 1
            assert(cost.gte(tokenCount))
        }
    })

    it('should allow buying and selling outcome tokens in the same transaction', async () => {
        // Create event
        const numOutcomes = 4
        const questionId = '0xf00dcafef00dcafef00dcafef00dcafef00dcafef00dcafef00dcafef00dcafe'
        const investor = 5
        const oracleAddress = accounts[1]
        const conditionId = await getParamFromTxEvent(
            await pmSystem.prepareCondition(oracleAddress, questionId, toBN(numOutcomes)),
            'conditionId')

        // Create and fund lmsrMarketMaker
        const funding = toBN(1e18)
        await etherToken.deposit({ value: funding, from: accounts[investor] })
        await etherToken.approve(lmsrMarketMakerFactory.address, funding, { from: accounts[investor] })
        assert.equal(await etherToken.balanceOf.call(accounts[investor]).then(v => v.toString()), funding.toString())

        const feeFactor = toBN(0)  // 0%
        const lmsrMarketMaker = await getParamFromTxEvent(
            await lmsrMarketMakerFactory.createLMSRMarketMaker(pmSystem.address, etherToken.address, [conditionId], feeFactor, whitelist.address, funding,
                { from: accounts[investor] }),
            'lmsrMarketMaker', LMSRMarketMaker, 'LMSRMarketMakerCreation')
        
        assert.equal(await etherToken.balanceOf.call(accounts[investor]).then(v => v.toString()), '0')

        const trader = 6
        const initialOutcomeTokenCount = toBN(1e18)
        const initialWETH9Count = toBN(10e18)

        // User buys all outcomes
        await etherToken.deposit({ value: initialOutcomeTokenCount.add(initialWETH9Count), from: accounts[trader] })
        await etherToken.approve(pmSystem.address, initialOutcomeTokenCount, { from: accounts[trader] })
        await pmSystem.splitPosition(etherToken.address, "0x00", conditionId, [...Array(numOutcomes).keys()].map(i => toBN(1 << i)), initialOutcomeTokenCount, { from: accounts[trader] })

        // User trades with the lmsrMarketMaker
        const tradeValues = [5e17, -1e18, -1e17, 2e18].map(toBN)
        const cost = await lmsrMarketMaker.calcNetCost.call(tradeValues)
        if(cost.gtn(0)) await etherToken.approve(lmsrMarketMaker.address, cost, { from: accounts[trader] })

        await pmSystem.setApprovalForAll(lmsrMarketMaker.address, true, { from: accounts[trader] })

        assert.equal(await getParamFromTxEvent(
            await lmsrMarketMaker.trade(tradeValues, cost, { from: accounts[trader] }), 'outcomeTokenNetCost'
        ).then(v => v.toString()), cost.toString())

        // All state transitions associated with trade have been performed
        for(const [tradeValue, i] of tradeValues.map((v, i) => [v, i])) {
            assert.equal(await pmSystem.balanceOf.call(accounts[trader], getPositionId(
                etherToken.address,
                getCollectionId(
                    conditionId,
                    1 << i,
                )
            )).then(v => v.toString()), initialOutcomeTokenCount.add(tradeValue))
        }

        assert.equal(await etherToken.balanceOf.call(accounts[trader]).then(v => v.toString()), initialWETH9Count.sub(cost).toString())
    })
})


contract('LMSRMarketMaker', function (accounts) {
    let pmSystem
    let etherToken
    let conditionId
    let lmsrMarketMakerFactory
    let whitelist
    let centralizedOracle
    let questionId = 100
    const numOutcomes = 2

    before(async () => {
        pmSystem = await ConditionalTokens.deployed()
        etherToken = await WETH9.deployed()
        lmsrMarketMakerFactory = await LMSRMarketMakerFactory.deployed()
        whitelist = await Whitelist.deployed()
    })

    beforeEach(async () => {
        // create event
        centralizedOracle = accounts[1]
        questionId++
        conditionId = await getParamFromTxEvent(
            await pmSystem.prepareCondition(centralizedOracle, toHex(questionId), toBN(numOutcomes)),
            'conditionId')
    })

    it('can be created and closed', async () => {
        // Create lmsrMarketMaker
        const buyer = 5
        const funding = toBN(100)
        const feeFactor = toBN(0)
                
        await etherToken.deposit({ value: funding, from: accounts[buyer] })
        await etherToken.approve(lmsrMarketMakerFactory.address, funding, { from: accounts[buyer] }) 

        assert.equal(await etherToken.balanceOf.call(accounts[buyer]).then(v => v.toString()), funding.toString())

        const lmsrMarketMaker = await getParamFromTxEvent(
            await lmsrMarketMakerFactory.createLMSRMarketMaker(pmSystem.address, etherToken.address, [conditionId], feeFactor, whitelist.address, funding, { from: accounts[buyer] }),
            'lmsrMarketMaker', LMSRMarketMaker, 'LMSRMarketMakerCreation'
        )

        // Close lmsrMarketMaker
        await lmsrMarketMaker.close({ from: accounts[buyer] })

        // LMSRMarketMaker can only be closed once
        await assertRejects(lmsrMarketMaker.close({ from: accounts[buyer] }), 'lmsrMarketMaker closed twice')

        // Sell all outcomes
        await pmSystem.setApprovalForAll(lmsrMarketMaker.address, true, { from: accounts[buyer] })
        await pmSystem.mergePositions(etherToken.address, '0x00', conditionId, [...Array(numOutcomes).keys()].map(i => toBN(1 << i)), funding, { from: accounts[buyer] })
        assert.equal(await etherToken.balanceOf.call(accounts[buyer]).then(v => v.toString()), funding.toString())
    })

    it('should allow buying and selling', async () => {
        // create lmsrMarketMaker
        const investor = 0

        const feeFactor = toBN(5e16)  // 5%
        const funding = toBN(1e18)

        await etherToken.deposit({ value: funding, from: accounts[investor] })
        await etherToken.approve(lmsrMarketMakerFactory.address, funding, { from: accounts[investor] }) 
        assert.equal(await etherToken.balanceOf.call(accounts[investor]).then(v => v.toString()), funding.toString())
     
        const lmsrMarketMaker = await getParamFromTxEvent(
            await lmsrMarketMakerFactory.createLMSRMarketMaker(pmSystem.address, etherToken.address, [conditionId], feeFactor, whitelist.address, funding, { from: accounts[investor] }),
            'lmsrMarketMaker', LMSRMarketMaker, 'LMSRMarketMakerCreation'
        )

        assert.equal(await etherToken.balanceOf.call(accounts[investor]).then(v => v.toString()), '0')

        // Buy outcome tokens
        const buyer = 1
        const outcome = 0
        const positionId = getPositionId(
                etherToken.address,
                getCollectionId(
                    conditionId,
                    1 << outcome,
                )
            )
        const tokenCount = toBN(1e15)
        let outcomeTokenAmounts = Array.from({length: numOutcomes}, (v, i) => i === outcome ? tokenCount : toBN(0))
        const outcomeTokenCost = await lmsrMarketMaker.calcNetCost.call(outcomeTokenAmounts)

        let fee = await lmsrMarketMaker.calcMarketFee.call(outcomeTokenCost)
        assert.equal(fee.toString(), outcomeTokenCost.muln(5).divn(100).toString())

        const cost = fee.add(outcomeTokenCost)
        await etherToken.deposit({ value: cost, from: accounts[buyer] })
        assert.equal(await etherToken.balanceOf.call(accounts[buyer]).then(v => v.toString()), cost.toString())

        await etherToken.approve(lmsrMarketMaker.address, cost, { from: accounts[buyer] })
        assert.equal(await getParamFromTxEvent(
            await lmsrMarketMaker.trade(outcomeTokenAmounts, cost, { from: accounts[buyer] }), 'outcomeTokenNetCost'
        ), outcomeTokenCost.toString())

        assert.equal(await pmSystem.balanceOf.call(accounts[buyer], positionId).then(v => v.toString()), tokenCount.toString())
        assert.equal(await etherToken.balanceOf.call(accounts[buyer]).then(v => v.toString()), 0)

        // Sell outcome tokens
        outcomeTokenAmounts = Array.from({length: numOutcomes}, (v, i) => i === outcome ? tokenCount.neg() : toBN(0))
        const outcomeTokenProfit = (await lmsrMarketMaker.calcNetCost.call(outcomeTokenAmounts)).neg()
        fee = await lmsrMarketMaker.calcMarketFee.call(outcomeTokenProfit)
        const profit = outcomeTokenProfit.sub(fee)

        await pmSystem.setApprovalForAll(lmsrMarketMaker.address, true, { from: accounts[buyer] })
        assert.equal(await getParamFromTxEvent(
            await lmsrMarketMaker.trade(outcomeTokenAmounts, profit.neg(), { from: accounts[buyer] }), 'outcomeTokenNetCost'
        ).then(v => v.neg().toString()), outcomeTokenProfit.toString())

        assert.equal(await pmSystem.balanceOf.call(accounts[buyer], positionId).then(v => v.toString()), '0')
        assert.equal(await etherToken.balanceOf.call(accounts[buyer]).then(v => v.toString()), profit.toString())
    })

    it('should allow short selling', async () => {
        // create lmsrMarketMaker
        const investor = 7

        const feeFactor = toBN(50000)  // 5%
        const funding = toBN(1e18)
        await etherToken.deposit({ value: funding, from: accounts[investor] })
        await etherToken.approve(lmsrMarketMakerFactory.address, funding, { from: accounts[investor] }) 

        const lmsrMarketMaker = await getParamFromTxEvent(
            await lmsrMarketMakerFactory.createLMSRMarketMaker(pmSystem.address, etherToken.address, [conditionId], feeFactor, whitelist.address, funding, { from: accounts[investor] }),
            'lmsrMarketMaker', LMSRMarketMaker, 'LMSRMarketMakerCreation'
        )

        assert.equal(await etherToken.balanceOf.call(accounts[investor]).then(v => v.toString()), '0')

        // Short sell outcome tokens
        const buyer = 7
        const outcome = 0
        const differentOutcome = 1
        const differentPositionId = getPositionId(
                etherToken.address,
                getCollectionId(
                    conditionId,
                    1 << differentOutcome,
                )
            )
        const tokenCount = toBN(1e15)
        const outcomeTokenAmounts = Array.from({length: numOutcomes}, (v, i) => i !== outcome ? tokenCount : toBN(0))
        const outcomeTokenCost = await lmsrMarketMaker.calcNetCost.call(outcomeTokenAmounts)
        const fee = await lmsrMarketMaker.calcMarketFee.call(outcomeTokenCost)
        const cost = outcomeTokenCost.add(fee)

        await etherToken.deposit({ value: cost, from: accounts[buyer] })
        assert.equal(await etherToken.balanceOf.call(accounts[buyer]).then(v => v.toString()), cost.toString())
        await etherToken.approve(lmsrMarketMaker.address, cost, { from: accounts[buyer] })

        assert.equal(
            await getParamFromTxEvent(
                await lmsrMarketMaker.trade(outcomeTokenAmounts, cost, { from: accounts[buyer] }),
                'outcomeTokenNetCost'
            ).then(v => v.toString()), outcomeTokenCost.toString())

        assert.equal(await etherToken.balanceOf.call(accounts[buyer]).then(v => v.toString()), '0')
        assert.equal(await pmSystem.balanceOf.call(accounts[buyer], differentPositionId).then(v => v.toString()), tokenCount.toString())
    })

    it('trading stress testing', async () => {
        const MAX_VALUE = toBN(2).pow(toBN(256)).subn(1)

        const trader = 9
        const feeFactor = toBN(0)
        const funding = toBN(1e16)

        await etherToken.deposit({ value: funding, from: accounts[trader] })
        await etherToken.approve(lmsrMarketMakerFactory.address, funding, { from: accounts[trader] }) 

        const lmsrMarketMaker = await getParamFromTxEvent(
            await lmsrMarketMakerFactory.createLMSRMarketMaker(pmSystem.address, etherToken.address, [conditionId], feeFactor, whitelist.address, funding, { from: accounts[trader] }),
            'lmsrMarketMaker', LMSRMarketMaker, 'LMSRMarketMakerCreation'
        )

        const positionIds = [...Array(numOutcomes).keys()].map(i => getPositionId(
                etherToken.address,
                getCollectionId(
                    conditionId,
                    1 << i,
                )
            ))

        // Get ready for trading
        const tradingStipend = toBN(1e19)
        await etherToken.deposit({ value: tradingStipend.muln(2), from: accounts[trader] })
        await etherToken.approve(pmSystem.address, tradingStipend, { from: accounts[trader] })
        await pmSystem.splitPosition(etherToken.address, '0x00', conditionId, [...Array(numOutcomes).keys()].map(i => 1 << i), tradingStipend, { from: accounts[trader] })

        // Allow all trading
        await etherToken.approve(lmsrMarketMaker.address, MAX_VALUE, { from: accounts[trader] })
        await pmSystem.setApprovalForAll(lmsrMarketMaker.address, true, { from: accounts[trader] })

        for(let i = 0; i < 10; i++) {
            const outcomeTokenAmounts = randnums(-1e16, 1e16, numOutcomes).map(n => toBN(n.valueOf()))
            const netCost = await lmsrMarketMaker.calcNetCost.call(outcomeTokenAmounts)

            const lmsrMarketMakerOutcomeTokenCounts = await Promise.all(positionIds.map(positionId =>
                pmSystem.balanceOf.call(lmsrMarketMaker.address, positionId)))

            const lmsrMarketMakerCollateralTokenCount = await etherToken.balanceOf.call(lmsrMarketMaker.address)

            let txResult;
            try {
                txResult = await lmsrMarketMaker.trade(outcomeTokenAmounts, netCost, { from: accounts[trader] })
            } catch(e) {
                throw new Error(`trade ${ i } with input ${
                    outcomeTokenAmounts
                } and limit ${
                    netCost
                } failed while lmsrMarketMaker has:\n\n${
                    lmsrMarketMakerOutcomeTokenCounts.map(c => c.toString()).join('\n')
                }\n\nand ${
                    lmsrMarketMakerCollateralTokenCount.toString()
                }: ${
                    e.message
                }`)
            }

            if(txResult)
                assert.equal(
                    (await getParamFromTxEvent(txResult, 'outcomeTokenNetCost')).toString(),
                    netCost.toString())
        }
    })
})
