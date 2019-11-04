const LMSRMarketMakerFactory = artifacts.require('LMSRMarketMakerFactory')
const FixedProductMarketMakerFactory = artifacts.require('FixedProductMarketMakerFactory')

module.exports = function (deployer) {
    deployer.link(artifacts.require('Fixed192x64Math'), LMSRMarketMakerFactory)
    deployer.deploy(LMSRMarketMakerFactory)
    deployer.deploy(FixedProductMarketMakerFactory)
}