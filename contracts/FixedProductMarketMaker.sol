pragma solidity ^0.5.1;

import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import { ConditionalTokens } from "@gnosis.pm/conditional-tokens-contracts/contracts/ConditionalTokens.sol";
import { CTHelpers } from "@gnosis.pm/conditional-tokens-contracts/contracts/CTHelpers.sol";
import { ERC1155TokenReceiver } from "@gnosis.pm/conditional-tokens-contracts/contracts/ERC1155/ERC1155TokenReceiver.sol";


contract FixedProductMarketMaker is ERC20, ERC1155TokenReceiver {
    using SafeMath for uint;

    uint constant ONE = 10**18;

    ConditionalTokens public conditionalTokens;
    IERC20 public collateralToken;
    bytes32[] public conditionIds;
    uint public fee;

    uint[] outcomeSlotCounts;
    bytes32[][] collectionIds;
    uint[] positionIds;

    // constructor(
    //     ConditionalTokens _conditionalTokens,
    //     IERC20 _collateralToken,
    //     bytes32[] memory _conditionIds,
    //     uint _fee
    // ) public {
    //     conditionalTokens = _conditionalTokens;
    //     collateralToken = _collateralToken;
    //     conditionIds = _conditionIds;
    //     fee = _fee;

    //     uint atomicOutcomeSlotCount = 1;
    //     outcomeSlotCounts = new uint[](conditionIds.length);
    //     for (uint i = 0; i < conditionIds.length; i++) {
    //         uint outcomeSlotCount = conditionalTokens.getOutcomeSlotCount(conditionIds[i]);
    //         atomicOutcomeSlotCount *= outcomeSlotCount;
    //         outcomeSlotCounts[i] = outcomeSlotCount;
    //     }
    //     require(atomicOutcomeSlotCount > 1, "conditions must be valid");

    //     collectionIds = new bytes32[][](conditionIds.length);
    //     _recordCollectionIDsForAllConditions(conditionIds.length, bytes32(0));
    //     require(positionIds.length == atomicOutcomeSlotCount, "position IDs construction failed!?");
    // }

    // function _recordCollectionIDsForAllConditions(uint conditionsLeft, bytes32 parentCollectionId) private {
    //     if(conditionsLeft == 0) {
    //         positionIds.push(CTHelpers.getPositionId(collateralToken, parentCollectionId));
    //         return;
    //     }

    //     conditionsLeft--;

    //     uint outcomeSlotCount = outcomeSlotCounts[conditionsLeft];

    //     collectionIds[conditionsLeft].push(parentCollectionId);
    //     for(uint i = 0; i < outcomeSlotCount; i++) {
    //         _recordCollectionIDsForAllConditions(
    //             conditionsLeft,
    //             CTHelpers.getCollectionId(
    //                 parentCollectionId,
    //                 conditionIds[conditionsLeft],
    //                 1 << i
    //             )
    //         );
    //     }
    // }

    function getPoolBalances() private view returns (uint[] memory) {
        address[] memory thises = new address[](positionIds.length);
        for(uint i = 0; i < positionIds.length; i++) {
            thises[i] = address(this);
        }
        return conditionalTokens.balanceOfBatch(thises, positionIds);
    }

    function generateBasicPartition(uint outcomeSlotCount)
        private
        pure
        returns (uint[] memory partition)
    {
        partition = new uint[](outcomeSlotCount);
        for(uint i = 0; i < outcomeSlotCount; i++) {
            partition[i] = 1 << i;
        }
    }

    function splitPositionThroughAllConditions(uint amount)
        private
    {
        for(uint i = conditionIds.length - 1; int(i) >= 0; i--) {
            uint[] memory partition = generateBasicPartition(outcomeSlotCounts[i]);
            for(uint j = 0; j < collectionIds[i].length; j++) {
                conditionalTokens.splitPosition(collateralToken, collectionIds[i][j], conditionIds[i], partition, amount);
            }
        }
    }

    function mergePositionsThroughAllConditions(uint amount)
        private
    {
        for(uint i = 0; i < conditionIds.length; i++) {
            uint[] memory partition = generateBasicPartition(outcomeSlotCounts[i]);
            for(uint j = 0; j < collectionIds[i].length; j++) {
                conditionalTokens.mergePositions(collateralToken, collectionIds[i][j], conditionIds[i], partition, amount);
            }
        }
    }

    function addFunding(uint addedFunds, uint[] calldata distributionHint)
        external
    {
        require(addedFunds > 0, "funding must be non-zero");
        require(collateralToken.transferFrom(msg.sender, address(this), addedFunds), "funding transfer failed");
        require(collateralToken.approve(address(conditionalTokens), addedFunds), "approval for splits failed");
        splitPositionThroughAllConditions(addedFunds);

        uint[] memory sendBackAmounts = new uint[](0);
        uint poolShareSupply = totalSupply();
        if(poolShareSupply > 0) {
            require(distributionHint.length == 0, "cannot use distribution hint after initial funding");
            uint[] memory poolBalances = getPoolBalances();

            uint maxBalance = 0;
            for(uint i = 0; i < poolBalances.length; i++) {
                uint balance = poolBalances[i];
                if(maxBalance < balance)
                    maxBalance = balance;
            }

            sendBackAmounts = new uint[](poolBalances.length);

            for(uint i = 0; i < poolBalances.length; i++) {
                uint remaining = addedFunds.mul(poolBalances[i]) / maxBalance;
                sendBackAmounts[i] = addedFunds.sub(remaining);
            }

            _mint(msg.sender, addedFunds.mul(maxBalance) / poolShareSupply);
        } else {
            if(distributionHint.length > 0) {
                require(distributionHint.length == positionIds.length, "hint length off");
                uint maxHint = 0;
                for(uint i = 0; i < distributionHint.length; i++) {
                    uint hint = distributionHint[i];
                    if(maxHint < hint)
                        maxHint = hint;
                }

                sendBackAmounts = new uint[](distributionHint.length);

                for(uint i = 0; i < distributionHint.length; i++) {
                    uint remaining = addedFunds.mul(distributionHint[i]) / maxHint;
                    require(remaining > 0, "must hint a valid distribution");
                    sendBackAmounts[i] = addedFunds.sub(remaining);
                }
            }

            _mint(msg.sender, addedFunds);
        }

        if(sendBackAmounts.length == positionIds.length)
            conditionalTokens.safeBatchTransferFrom(address(this), msg.sender, positionIds, sendBackAmounts, "");
    }

    function removeFunding(uint sharesToBurn)
        external
    {
        uint[] memory poolBalances = getPoolBalances();

        uint[] memory sendAmounts = new uint[](poolBalances.length);

        uint poolShareSupply = totalSupply();
        for(uint i = 0; i < poolBalances.length; i++) {
            sendAmounts[i] = poolBalances[i].mul(sharesToBurn) / poolShareSupply;
        }

        _burn(msg.sender, sharesToBurn);
        conditionalTokens.safeBatchTransferFrom(address(this), msg.sender, positionIds, sendAmounts, "");
    }

    function onERC1155Received(
        address operator,
        address from,
        uint256 id,
        uint256 value,
        bytes calldata data
    )
        external
        returns (bytes4)
    {
        if (operator == address(this)) {
            return this.onERC1155Received.selector;
        }
        return 0x0;
    }

    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    )
        external
        returns (bytes4)
    {
        if (operator == address(this) && from == address(0)) {
            return this.onERC1155BatchReceived.selector;
        }
        return 0x0;
    }

    function calcBuyAmount(uint investmentAmount, uint outcomeIndex) public view returns (uint) {
        require(outcomeIndex < positionIds.length, "invalid outcome index");

        uint[] memory poolBalances = getPoolBalances();
        uint investmentAmountMinusFees = investmentAmount.sub(investmentAmount.mul(fee) / ONE);
        uint balancesProduct = 1;
        uint denom = 1;
        uint buyTokenPoolBalance;
        for(uint i = 0; i < poolBalances.length; i++) {
            uint poolBalance = poolBalances[i];
            balancesProduct = balancesProduct.mul(poolBalance);
            if(i == outcomeIndex)
                buyTokenPoolBalance = poolBalance;
            else
                denom = denom.mul(poolBalance.add(investmentAmountMinusFees));
        }
        require(balancesProduct > 0, "must have non-zero balances");
        require(denom > 0, "must end up with valid denominator");

        return buyTokenPoolBalance.add(investmentAmount).sub(balancesProduct / denom);
    }

    function calcSellAmount(uint returnAmount, uint outcomeIndex) public view returns (uint outcomeTokenSellAmount) {
        require(outcomeIndex < positionIds.length, "invalid outcome index");

        uint[] memory poolBalances = getPoolBalances();
        uint returnAmountPlusFees = returnAmount.add(returnAmount.mul(fee) / ONE);
        uint balancesProduct = 1;
        uint denom = 1;
        uint sellTokenPoolBalance;
        for(uint i = 0; i < poolBalances.length; i++) {
            uint poolBalance = poolBalances[i];
            balancesProduct = balancesProduct.mul(poolBalance);
            if(i == outcomeIndex)
                sellTokenPoolBalance = poolBalance;
            else
                denom = denom.mul(poolBalance.sub(returnAmountPlusFees));
        }
        require(balancesProduct > 0, "must have non-zero balances");
        require(denom > 0, "must end up with valid denominator");

        return returnAmount.add(balancesProduct / denom).sub(sellTokenPoolBalance);
    }

    function buy(uint investmentAmount, uint outcomeIndex, uint minOutcomeTokensToBuy) external {
        uint outcomeTokensToBuy = calcBuyAmount(investmentAmount, outcomeIndex);
        require(outcomeTokensToBuy >= minOutcomeTokensToBuy, "minimum buy amount not reached");

        require(collateralToken.transferFrom(msg.sender, address(this), investmentAmount), "cost transfer failed");
        require(collateralToken.approve(address(conditionalTokens), investmentAmount), "approval for splits failed");
        splitPositionThroughAllConditions(investmentAmount);
        conditionalTokens.safeTransferFrom(address(this), msg.sender, positionIds[outcomeIndex], outcomeTokensToBuy, "");
    }

    function sell(uint returnAmount, uint outcomeIndex, uint maxOutcomeTokensToSell) external {
        uint outcomeTokensToSell = calcSellAmount(returnAmount, outcomeIndex);
        require(outcomeTokensToSell <= maxOutcomeTokensToSell, "maximum sell amount exceeded");

        conditionalTokens.safeTransferFrom(msg.sender, address(this), positionIds[outcomeIndex], outcomeTokensToSell, "");
        mergePositionsThroughAllConditions(returnAmount);
        require(collateralToken.transfer(msg.sender, returnAmount), "return transfer failed");
    }
}
