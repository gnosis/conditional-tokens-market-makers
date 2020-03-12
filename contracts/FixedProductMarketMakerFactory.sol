pragma solidity ^0.5.1;

import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { ConditionalTokens } from "@gnosis.pm/conditional-tokens-contracts/contracts/ConditionalTokens.sol";
import { CTHelpers } from "@gnosis.pm/conditional-tokens-contracts/contracts/CTHelpers.sol";
import { ConstructedCloneFactory } from "@gnosis.pm/util-contracts/contracts/ConstructedCloneFactory.sol";
import { FixedProductMarketMaker, FixedProductMarketMakerData } from "./FixedProductMarketMaker.sol";
import { ERC1155TokenReceiver } from "@gnosis.pm/conditional-tokens-contracts/contracts/ERC1155/ERC1155TokenReceiver.sol";


contract FixedProductMarketMakerFactory is ConstructedCloneFactory, FixedProductMarketMakerData {
    event FixedProductMarketMakerCreation(
        address indexed creator,
        FixedProductMarketMaker fixedProductMarketMaker,
        ConditionalTokens indexed conditionalTokens,
        IERC20 indexed collateralToken,
        bytes32[] conditionIds,
        uint fee
    );

    FixedProductMarketMaker public implementationMaster;

    constructor() public {
        implementationMaster = new FixedProductMarketMaker();
    }

    function cloneConstructor(bytes calldata consData) external {
        (
            ConditionalTokens _conditionalTokens,
            IERC20 _collateralToken,
            bytes32[] memory _conditionIds,
            uint _fee
        ) = abi.decode(consData, (ConditionalTokens, IERC20, bytes32[], uint));

        _supportedInterfaces[_INTERFACE_ID_ERC165] = true;
        _supportedInterfaces[
            ERC1155TokenReceiver(0).onERC1155Received.selector ^
            ERC1155TokenReceiver(0).onERC1155BatchReceived.selector
        ] = true;

        conditionalTokens = _conditionalTokens;
        collateralToken = _collateralToken;
        conditionIds = _conditionIds;
        fee = _fee;

        uint atomicOutcomeSlotCount = 1;
        outcomeSlotCounts = new uint[](conditionIds.length);
        for (uint i = 0; i < conditionIds.length; i++) {
            uint outcomeSlotCount = conditionalTokens.getOutcomeSlotCount(conditionIds[i]);
            atomicOutcomeSlotCount *= outcomeSlotCount;
            outcomeSlotCounts[i] = outcomeSlotCount;
        }
        require(atomicOutcomeSlotCount > 1, "conditions must be valid");

        collectionIds = new bytes32[][](conditionIds.length);
        _recordCollectionIDsForAllConditions(conditionIds.length, bytes32(0));
        require(positionIds.length == atomicOutcomeSlotCount, "position IDs construction failed!?");
    }

    function _recordCollectionIDsForAllConditions(uint conditionsLeft, bytes32 parentCollectionId) private {
        if(conditionsLeft == 0) {
            positionIds.push(CTHelpers.getPositionId(collateralToken, parentCollectionId));
            return;
        }

        conditionsLeft--;

        uint outcomeSlotCount = outcomeSlotCounts[conditionsLeft];

        collectionIds[conditionsLeft].push(parentCollectionId);
        for(uint i = 0; i < outcomeSlotCount; i++) {
            _recordCollectionIDsForAllConditions(
                conditionsLeft,
                CTHelpers.getCollectionId(
                    parentCollectionId,
                    conditionIds[conditionsLeft],
                    1 << i
                )
            );
        }
    }

    function createFixedProductMarketMaker(
        ConditionalTokens conditionalTokens,
        IERC20 collateralToken,
        bytes32[] calldata conditionIds,
        uint fee
    )
        external
        returns (FixedProductMarketMaker)
    {
        FixedProductMarketMaker fixedProductMarketMaker = FixedProductMarketMaker(
            createClone(address(implementationMaster), abi.encode(
                conditionalTokens,
                collateralToken,
                conditionIds,
                fee
            ))
        );
        emit FixedProductMarketMakerCreation(
            msg.sender,
            fixedProductMarketMaker,
            conditionalTokens,
            collateralToken,
            conditionIds,
            fee
        );
        return fixedProductMarketMaker;
    }
}
