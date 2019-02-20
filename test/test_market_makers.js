const _ = require('lodash')
const rlp = require('rlp')
const utils = require('./utils')
const { ONE, isClose, lmsrMarginalPrice, getParamFromTxEvent, assertRejects, Decimal, randnums } = utils
const { toBN, soliditySha3, toHex, keccak256, toChecksumAddress } = web3.utils

const PredictionMarketSystem = artifacts.require('PredictionMarketSystem')
const LMSRMarketMakerFactory = artifacts.require('LMSRMarketMakerFactory')
const LMSRMarketMaker = artifacts.require('LMSRMarketMaker')
const WETH9 = artifacts.require('WETH9')

contract('MarketMaker', function(accounts) {
    let pmSystem
    let lmsrMarketMakerFactory
    let etherToken
    let nonce = 0x01
    
    beforeEach(async () => {
        pmSystem = await PredictionMarketSystem.deployed()
        lmsrMarketMakerFactory = await LMSRMarketMakerFactory.deployed()
        etherToken = await WETH9.deployed()
    })
    
    it('should move price of an outcome to 0 after participants sell lots of that outcome to lmsrMarketMaker maker', async () => {
        // Create event
        const numOutcomes = 2
        const netOutcomeTokensSold = new Array(numOutcomes).fill(0)
        const questionId = '0xf00dcafef00dcafef00dcafef00dcafef00dcafef00dcafef00dcafef00dcafe'
        const oracleAddress = accounts[1]

        // Calculate the address of the LMSR via nonce before it's deployed (in order to allow approve() call)
        const checksummedLMSRAddress = toChecksumAddress(keccak256(rlp.encode([lmsrMarketMakerFactory.address, nonce])).substr(26));
        
        const conditionId = await getParamFromTxEvent(
            await pmSystem.prepareCondition(oracleAddress, questionId, numOutcomes),
        'conditionId')

        const investor = 0
        const feeFactor = 0  // 0%
     
        // Create and fund lmsrMarketMaker
        const funding = toBN(1e17)
        await etherToken.deposit({ value: funding, from: accounts[investor] })
        await etherToken.approve(checksummedLMSRAddress, funding, { from: accounts[investor] })
        assert.equal(await etherToken.balanceOf(accounts[investor]).then(v => v.toString()), funding.toString())
        
        const lmsrMarketMaker = await getParamFromTxEvent(
            await lmsrMarketMakerFactory.createLMSRMarketMaker(pmSystem.address, etherToken.address, [conditionId], feeFactor, toBN(1e17),{ from: accounts[investor] }), 'lmsrMarketMaker', LMSRMarketMaker)
        nonce++;
        assert.equal(await etherToken.balanceOf(accounts[investor]).then(v => v.toString()), '0')
        
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
        const buyerBalance = await etherToken.balanceOf(accounts[trader])
        
        let profit, outcomeTokenAmounts
        for(const i of _.range(loopCount.toNumber())) {
            // Calculate profit for selling tokens
            outcomeTokenAmounts = Array.from({length: numOutcomes}, (v, i) => i === outcome ? tokenCount.neg() : toBN(0))
            profit = (await lmsrMarketMaker.calcNetCost(outcomeTokenAmounts)).neg()
            if(profit.eqn(0))
                break

            // Selling tokens
            assert.equal((await getParamFromTxEvent(
                await lmsrMarketMaker.trade(outcomeTokenAmounts, profit.neg(), false, { from: accounts[trader] }), 'outcomeTokenNetCost'
            )).neg().toString(), profit.toString())

            netOutcomeTokensSold[outcome] -= tokenCountRaw
            const expected = lmsrMarginalPrice(funding, netOutcomeTokensSold, outcome)
            const actual = new Decimal(await lmsrMarketMaker.calcMarginalPrice(toBN(outcome)).then(v => v.toString())).div(ONE)
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
        assert((await etherToken.balanceOf(accounts[trader])).gt(buyerBalance), 'trader balance did not increase')
    })

    it('should move price of an outcome to 1 after participants buy lots of that outcome from lmsrMarketMaker maker', async () => {
        // Prepare condition
        const numOutcomes = 2
        const questionId = '0xf00dcafef00dcafef00dcafef00dcafef00dcafef00dcafef00dcafef00dcafe'
        const oracleAddress = accounts[5]
        const conditionId = await getParamFromTxEvent(await pmSystem.prepareCondition(oracleAddress, questionId, toBN(numOutcomes)), 'conditionId')
        
        for(const [investor, funding, tokenCountRaw] of [
            [2, toBN(1e17), 1e18],
            [3, toBN(1), 10],
            [4, toBN(1), 1e18],
        ]) {
            // // Calculate the address of the LMSR via nonce before it's deployed (in order to allow approve() call)
            const checksummedLMSRAddress = toChecksumAddress(keccak256(rlp.encode([lmsrMarketMakerFactory.address, nonce])).substr(26));
            await etherToken.deposit({ value: funding, from: accounts[investor] })
            await etherToken.approve(checksummedLMSRAddress, funding, { from: accounts[investor] })
            
            const tokenCount = toBN(tokenCountRaw)
            const netOutcomeTokensSold = new Array(numOutcomes).fill(0)
            
            // Create and Fund lmsrMarketMaker
            assert.equal((await etherToken.balanceOf(accounts[investor])).toString(), funding.toString())
            const feeFactor = 0  // 0%
            const lmsrMarketMaker = await getParamFromTxEvent(
                await lmsrMarketMakerFactory.createLMSRMarketMaker(pmSystem.address, etherToken.address, [conditionId], feeFactor, funding, { from: accounts[investor] }),'lmsrMarketMaker', LMSRMarketMaker)
            nonce++
            assert.equal((await etherToken.balanceOf(accounts[investor])).toString(), '0')

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
                cost = await lmsrMarketMaker.calcNetCost(outcomeTokenAmounts)

                // Buying tokens
                await etherToken.approve(lmsrMarketMaker.address, cost, { from: accounts[trader] })
                assert.equal((await getParamFromTxEvent(
                    await lmsrMarketMaker.trade(outcomeTokenAmounts, cost, false, { from: accounts[trader] }), 'outcomeTokenNetCost'
                )).toString(), cost.toString())

                netOutcomeTokensSold[outcome] += tokenCountRaw
                const expected = lmsrMarginalPrice(funding, netOutcomeTokensSold, outcome)
                const actual = new Decimal((await lmsrMarketMaker.calcMarginalPrice(toBN(outcome))).toString()).div(ONE)
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
        // // Calculate the address of the LMSR via nonce before it's deployed (in order to allow approve() call)
        const checksummedLMSRAddress = toChecksumAddress(keccak256(rlp.encode([lmsrMarketMakerFactory.address, nonce])).substr(26));
        const funding = toBN(1e18)
        const feeFactor = toBN(0)  // 0%
        await etherToken.deposit({ value: funding, from: accounts[investor] })
        await etherToken.approve(checksummedLMSRAddress, funding, { from: accounts[investor] })
        assert.equal(await etherToken.balanceOf(accounts[investor]).then(v => v.toString()), funding.toString())

        const lmsrMarketMaker = await getParamFromTxEvent(
            await lmsrMarketMakerFactory.createLMSRMarketMaker(pmSystem.address, etherToken.address, [conditionId], feeFactor, funding,
                { from: accounts[investor] }),
            'lmsrMarketMaker', LMSRMarketMaker)        
        nonce++

        assert.equal((await etherToken.balanceOf(accounts[investor])).toString(), '0')

        const trader = 6
        const initialOutcomeTokenCount = toBN(1e18)
        const initialWETH9Count = toBN(10e18)

        // User buys all outcomes
        await etherToken.deposit({ value: initialOutcomeTokenCount.add(initialWETH9Count), from: accounts[trader] })
        await etherToken.approve(pmSystem.address, initialOutcomeTokenCount, { from: accounts[trader] })
        await pmSystem.splitPosition(etherToken.address, "0x00", conditionId, [...Array(numOutcomes).keys()].map(i => toBN(1 << i)), initialOutcomeTokenCount, { from: accounts[trader] })

        // User trades with the lmsrMarketMaker
        const tradeValues = [5e17, -1e18, -1e17, 2e18].map(toBN)
        const cost = await lmsrMarketMaker.calcNetCost(tradeValues)
        if(cost.gtn(0)) await etherToken.approve(lmsrMarketMaker.address, cost, { from: accounts[trader] })

        await pmSystem.setApprovalForAll(lmsrMarketMaker.address, true, { from: accounts[trader] })

        assert.equal((await getParamFromTxEvent(
            await lmsrMarketMaker.trade(tradeValues, cost, false, { from: accounts[trader] }), 'outcomeTokenNetCost'
        )).toString(), cost.toString())

        // All state transitions associated with trade have been performed
        for(const [tradeValue, i] of tradeValues.map((v, i) => [v, i])) {
            assert.equal((await pmSystem.balanceOf(accounts[trader], soliditySha3(
                { t: 'address', v: etherToken.address },
                { t: 'bytes32', v: soliditySha3(
                    { t: 'bytes32', v: conditionId },
                    { t: 'uint', v: 1 << i },
                )}
            ))).toString(), initialOutcomeTokenCount.add(tradeValue))
        }

        assert.equal((await etherToken.balanceOf(accounts[trader])).toString(), initialWETH9Count.sub(cost).toString())
    })
})
