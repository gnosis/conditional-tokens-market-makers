module.exports = function (deployer, _network, accounts) {
    deployer.deploy(artifacts.require('Whitelist'), {
        overwrite: false
    }).then(whitelist => whitelist.addToWhitelist(accounts))
}
