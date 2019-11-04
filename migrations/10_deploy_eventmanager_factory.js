module.exports = function (deployer) {
    deployer.deploy(artifacts.require('ConditionalTokens'), {
        overwrite: false
    })
}
