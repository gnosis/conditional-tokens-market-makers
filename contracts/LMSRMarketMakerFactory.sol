pragma solidity ^0.4.24;

import "./LMSRMarketMaker.sol";

contract LMSRMarketMakerFactory {
    event LMSRMarketMakerCreation(address indexed creator, LMSRMarketMaker lmsrMarketMaker, PredictionMarketSystem pmSystem, IERC20 collateralToken, bytes32 conditionId, uint64 fee, uint funding);

    function createLMSRMarketMaker(PredictionMarketSystem pmSystem, IERC20 collateralToken, bytes32 conditionId, uint64 fee, uint funding)
        public
        returns (LMSRMarketMaker lmsrMarketMaker)
    {
        lmsrMarketMaker = new LMSRMarketMaker(pmSystem, collateralToken, conditionId, fee, funding);
        lmsrMarketMaker.transferOwnership(msg.sender);
        emit LMSRMarketMakerCreation(msg.sender, lmsrMarketMaker, pmSystem, collateralToken, conditionId, fee, funding);
    }
}
