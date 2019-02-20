const rlp = require('rlp')
const utils = require('./utils')
const { getParamFromTxEvent, assertRejects, randnums } = utils
const { toBN, soliditySha3, toHex, keccak256, toChecksumAddress } = web3.utils

const PredictionMarketSystem = artifacts.require('PredictionMarketSystem')
const LMSRMarketMakerFactory = artifacts.require('LMSRMarketMakerFactory')
const LMSRMarketMaker = artifacts.require('LMSRMarketMaker')
const WETH9 = artifacts.require('WETH9')

contract('LMSRMarketMaker', function (accounts) {
  let pmSystem
  let etherToken
  let conditionId
  let lmsrMarketMakerFactory
  let centralizedOracle
  let questionId = 100
  const numOutcomes = 2
  let nonce = 0x01

  before(async () => {
      pmSystem = await PredictionMarketSystem.deployed()
      etherToken = await WETH9.deployed()
      lmsrMarketMakerFactory = await LMSRMarketMakerFactory.deployed()
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
              
      // // Calculate the address of the LMSR via nonce before it's deployed (in order to allow approve() call)
      const checksummedLMSRAddress = toChecksumAddress(keccak256(rlp.encode([lmsrMarketMakerFactory.address, nonce])).substr(26));
      await etherToken.deposit({ value: funding, from: accounts[buyer] })
      await etherToken.approve(checksummedLMSRAddress, funding, { from: accounts[buyer] }) 

      assert.equal(await etherToken.balanceOf(accounts[buyer]).then(v => v.toString()), funding.toString())

      const lmsrMarketMaker = await getParamFromTxEvent(
          await lmsrMarketMakerFactory.createLMSRMarketMaker(pmSystem.address, etherToken.address, [conditionId], feeFactor, funding, { from: accounts[buyer] }),
          'lmsrMarketMaker', LMSRMarketMaker
      )
      nonce++

      // Close lmsrMarketMaker
      await lmsrMarketMaker.close({ from: accounts[buyer] })

      // LMSRMarketMaker can only be closed once
      await assertRejects(lmsrMarketMaker.close({ from: accounts[buyer] }), 'lmsrMarketMaker closed twice')

      // Sell all outcomes
      await pmSystem.setApprovalForAll(lmsrMarketMaker.address, true, { from: accounts[buyer] })
      await pmSystem.mergePositions(etherToken.address, '0x00', conditionId, [...Array(numOutcomes).keys()].map(i => toBN(1 << i)), funding, { from: accounts[buyer] })
      assert.equal(await etherToken.balanceOf(accounts[buyer]).then(v => v.toString()), funding.toString())
  })

  it('should allow buying and selling', async () => {
      // create lmsrMarketMaker
      const investor = 0

      const feeFactor = toBN(5e16)  // 5%
      const funding = toBN(1e18)

      // // Calculate the address of the LMSR via nonce before it's deployed (in order to allow approve() call)
      const checksummedLMSRAddress = toChecksumAddress(keccak256(rlp.encode([lmsrMarketMakerFactory.address, nonce])).substr(26));
      await etherToken.deposit({ value: funding, from: accounts[investor] })
      await etherToken.approve(checksummedLMSRAddress, funding, { from: accounts[investor] }) 
      assert.equal(await etherToken.balanceOf(accounts[investor]).then(v => v.toString()), funding.toString())
   
      const lmsrMarketMaker = await getParamFromTxEvent(
          await lmsrMarketMakerFactory.createLMSRMarketMaker(pmSystem.address, etherToken.address, [conditionId], feeFactor, funding, { from: accounts[investor] }),
          'lmsrMarketMaker', LMSRMarketMaker
      )
      nonce++

      assert.equal(await etherToken.balanceOf(accounts[investor]).then(v => v.toString()), '0')

      // Buy outcome tokens
      const buyer = 1
      const outcome = 0
      const positionId = soliditySha3(
              { t: 'address', v: etherToken.address },
              { t: 'bytes32', v: soliditySha3(
                  { t: 'bytes32', v: conditionId },
                  { t: 'uint', v: 1 << outcome },
              )}
          )
      const tokenCount = toBN(1e15)
      let outcomeTokenAmounts = Array.from({length: numOutcomes}, (v, i) => i === outcome ? tokenCount : toBN(0))
      const outcomeTokenCost = await lmsrMarketMaker.calcNetCost(outcomeTokenAmounts)

      let fee = await lmsrMarketMaker.calcMarketFee(outcomeTokenCost)
      assert.equal(fee.toString(), outcomeTokenCost.muln(5).divn(100).toString())

      const cost = fee.add(outcomeTokenCost)
      await etherToken.deposit({ value: cost, from: accounts[buyer] })
      assert.equal(await etherToken.balanceOf(accounts[buyer]).then(v => v.toString()), cost.toString())

      await etherToken.approve(lmsrMarketMaker.address, cost, { from: accounts[buyer] })
      assert.equal(await getParamFromTxEvent(
          await lmsrMarketMaker.trade(outcomeTokenAmounts, cost, false, { from: accounts[buyer] }), 'outcomeTokenNetCost'
      ), outcomeTokenCost.toString())

      assert.equal(await pmSystem.balanceOf(accounts[buyer], positionId).then(v => v.toString()), tokenCount.toString())
      assert.equal(await etherToken.balanceOf(accounts[buyer]).then(v => v.toString()), 0)

      // Sell outcome tokens
      outcomeTokenAmounts = Array.from({length: numOutcomes}, (v, i) => i === outcome ? tokenCount.neg() : toBN(0))
      const outcomeTokenProfit = (await lmsrMarketMaker.calcNetCost(outcomeTokenAmounts)).neg()
      fee = await lmsrMarketMaker.calcMarketFee(outcomeTokenProfit)
      const profit = outcomeTokenProfit.sub(fee)

      await pmSystem.setApprovalForAll(lmsrMarketMaker.address, true, { from: accounts[buyer] })
      assert.equal(await getParamFromTxEvent(
          await lmsrMarketMaker.trade(outcomeTokenAmounts, profit.neg(), false, { from: accounts[buyer] }), 'outcomeTokenNetCost'
      ).then(v => v.neg().toString()), outcomeTokenProfit.toString())

      assert.equal(await pmSystem.balanceOf(accounts[buyer], positionId).then(v => v.toString()), '0')
      assert.equal(await etherToken.balanceOf(accounts[buyer]).then(v => v.toString()), profit.toString())
  })

  it('should allow short selling', async () => {
      // create lmsrMarketMaker
      const investor = 7

      const feeFactor = toBN(50000)  // 5%
      const funding = toBN(1e18)
      // // Calculate the address of the LMSR via nonce before it's deployed (in order to allow approve() call)
      const checksummedLMSRAddress = toChecksumAddress(keccak256(rlp.encode([lmsrMarketMakerFactory.address, nonce])).substr(26));
      await etherToken.deposit({ value: funding, from: accounts[investor] })
      await etherToken.approve(checksummedLMSRAddress, funding, { from: accounts[investor] }) 

      const lmsrMarketMaker = await getParamFromTxEvent(
          await lmsrMarketMakerFactory.createLMSRMarketMaker(pmSystem.address, etherToken.address, [conditionId], feeFactor, funding, { from: accounts[investor] }),
          'lmsrMarketMaker', LMSRMarketMaker
      )
      nonce++

      assert.equal(await etherToken.balanceOf(accounts[investor]).then(v => v.toString()), '0')

      // Short sell outcome tokens
      const buyer = 7
      const outcome = 0
      const differentOutcome = 1
      const differentPositionId = soliditySha3(
              { t: 'address', v: etherToken.address },
              { t: 'bytes32', v: soliditySha3(
                  { t: 'bytes32', v: conditionId },
                  { t: 'uint', v: 1 << differentOutcome },
              )}
          )
      const tokenCount = toBN(1e15)
      const outcomeTokenAmounts = Array.from({length: numOutcomes}, (v, i) => i !== outcome ? tokenCount : toBN(0))
      const outcomeTokenCost = await lmsrMarketMaker.calcNetCost(outcomeTokenAmounts)
      const fee = await lmsrMarketMaker.calcMarketFee(outcomeTokenCost)
      const cost = outcomeTokenCost.add(fee)

      await etherToken.deposit({ value: cost, from: accounts[buyer] })
      assert.equal(await etherToken.balanceOf(accounts[buyer]).then(v => v.toString()), cost.toString())
      await etherToken.approve(lmsrMarketMaker.address, cost, { from: accounts[buyer] })

      assert.equal(
          await getParamFromTxEvent(
              await lmsrMarketMaker.trade(outcomeTokenAmounts, cost, false, { from: accounts[buyer] }),
              'outcomeTokenNetCost'
          ).then(v => v.toString()), outcomeTokenCost.toString())

      assert.equal(await etherToken.balanceOf(accounts[buyer]).then(v => v.toString()), '0')
      assert.equal(await pmSystem.balanceOf(accounts[buyer], differentPositionId).then(v => v.toString()), tokenCount.toString())
  })

  it('trading stress testing', async () => {
      const MAX_VALUE = toBN(2).pow(toBN(256)).subn(1)

      const trader = 9
      const feeFactor = toBN(0)
      const funding = toBN(1e16)

      // // Calculate the address of the LMSR via nonce before it's deployed (in order to allow approve() call)
      const checksummedLMSRAddress = toChecksumAddress(keccak256(rlp.encode([lmsrMarketMakerFactory.address, nonce])).substr(26));
      await etherToken.deposit({ value: funding, from: accounts[trader] })
      await etherToken.approve(checksummedLMSRAddress, funding, { from: accounts[trader] }) 

      const lmsrMarketMaker = await getParamFromTxEvent(
          await lmsrMarketMakerFactory.createLMSRMarketMaker(pmSystem.address, etherToken.address, [conditionId], feeFactor, funding, { from: accounts[trader] }),
          'lmsrMarketMaker', LMSRMarketMaker
      )
      nonce++

      const positionIds = [...Array(numOutcomes).keys()].map(i => soliditySha3(
              { t: 'address', v: etherToken.address },
              { t: 'bytes32', v: soliditySha3(
                  { t: 'bytes32', v: conditionId },
                  { t: 'uint', v: 1 << i },
              )}
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
          const netCost = await lmsrMarketMaker.calcNetCost(outcomeTokenAmounts)

          const lmsrMarketMakerOutcomeTokenCounts = await Promise.all(positionIds.map(positionId =>
              pmSystem.balanceOf(lmsrMarketMaker.address, positionId)))

          const lmsrMarketMakerCollateralTokenCount = await etherToken.balanceOf(lmsrMarketMaker.address)

          let txResult;
          try {
              txResult = await lmsrMarketMaker.trade(outcomeTokenAmounts, netCost, false, { from: accounts[trader] })
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
