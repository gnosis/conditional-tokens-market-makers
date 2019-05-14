pragma solidity ^0.5.1;

import "./LMSRMarketMaker.sol";

contract LMSRMarketMakerFactory {
    event LMSRMarketMakerCreation(address indexed creator, LMSRMarketMaker lmsrMarketMaker, PredictionMarketSystem pmSystem, IERC20 collateralToken, bytes32[] conditionIds, uint64 fee, uint funding);

    function createLMSRMarketMaker(PredictionMarketSystem pmSystem, IERC20 collateralToken, bytes32[] memory conditionIds, uint64 fee, uint funding)
        public
        returns (LMSRMarketMaker lmsrMarketMaker)
    {
        lmsrMarketMaker = new LMSRMarketMaker(pmSystem, collateralToken, conditionIds, fee);
        collateralToken.transferFrom(msg.sender, address(this), funding);
        collateralToken.approve(address(lmsrMarketMaker), funding);
        lmsrMarketMaker.changeFunding(int(funding));
        lmsrMarketMaker.resume();
        lmsrMarketMaker.transferOwnership(msg.sender);
        emit LMSRMarketMakerCreation(msg.sender, lmsrMarketMaker, pmSystem, collateralToken, conditionIds, fee, funding);
    }
}
