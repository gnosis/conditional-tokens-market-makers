const _ = require('lodash')

const PRECISION = 80
const Decimal = require('decimal.js').clone({ precision: PRECISION })

const ONE = Decimal(2).pow(64)

function isClose(a, b, relTol=1e-9, absTol=1e-18) {
    return new Decimal(a.toString()).sub(b).abs().lte(
        Decimal.max(
            Decimal.max(
                Decimal.abs(a.toString()),
                Decimal.abs(b.toString())
            ).mul(relTol),
            absTol))
}

// random int in [a, b)
function randrange(a, b) {
    return Decimal.random(PRECISION).mul(Decimal(b.valueOf()).sub(a)).add(a).floor()
}

function randnums(a, b, n) {
    return _.range(n).map(() => randrange(a, b))
}

async function getParamFromTxEvent(transaction, paramName, contractFactory, eventName) {
    assert.isObject(transaction)
    let logs = transaction.logs
    if(eventName != null) {
        logs = logs.filter((l) => l.event === eventName)
    }
    assert.equal(logs.length, 1, `expected one log but got ${logs.length} logs`)
    let param = logs[0].args[paramName]
    if(contractFactory != null) {
        let contract = await contractFactory.at(param)
        assert.isObject(contract, `getting ${paramName} failed for ${param}`)
        return contract
    } else {
        return param
    }
}

async function assertRejects(q, msg) {
    let res, catchFlag = false
    try {
        res = await q
    } catch(e) {
        catchFlag = true
    } finally {
        if(!catchFlag)
            assert.fail(res, null, msg)
    }
}

function getBlock(b) {
    return new Promise((resolve, reject) => {
        web3.eth.getBlock(b, (err, block) => {
            if(err) return reject(err)
            resolve(block)
        })
    })
}

function lmsrMarginalPrice(funding, netOutcomeTokensSold, outcomeIndex) {
    const b = new Decimal(funding.toString()).div(Decimal.ln(netOutcomeTokensSold.length))
    const numerator = new Decimal(netOutcomeTokensSold[outcomeIndex].toString()).div(b).exp()
    const denominator = netOutcomeTokensSold.reduce(
        (acc, tokensSold) => acc.add(new Decimal(tokensSold.toString()).div(b).exp()),
        new Decimal(0)
    )
    return numerator.div(denominator).toString()
}

Object.assign(exports, {
    Decimal,
    ONE,
    isClose,
    randrange,
    randnums,
    getParamFromTxEvent,
    assertRejects,
    getBlock,
    lmsrMarginalPrice,
})
