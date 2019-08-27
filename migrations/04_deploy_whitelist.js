module.exports = function (deployer, _network, accounts) {
    deployer.deploy(artifacts.require('Whitelist')).then(
        whitelist => whitelist.addToWhitelist(accounts))

}
