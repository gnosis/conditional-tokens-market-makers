pragma solidity ^0.5.1;
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "@gnosis.pm/util-contracts/contracts/Fixed192x64Math.sol";
import "@gnosis.pm/hg-contracts/contracts/PredictionMarketSystem.sol";
import "./MarketMaker.sol";

/// @title LMSR market maker contract - Calculates share prices based on share distribution and initial funding
/// @author Alan Lu - <alan.lu@gnosis.pm>
contract LMSRMarketMaker is MarketMaker {
    using SafeMath for uint;

    /*
     *  Constants
     */
    uint constant ONE = 0x10000000000000000;
    int constant EXP_LIMIT = 3394200909562557497344;

    constructor(PredictionMarketSystem _pmSystem, IERC20 _collateralToken, bytes32[] memory _conditionIds, uint64 _fee, uint _funding, address marketOwner)
        public
        MarketMaker(_pmSystem, _collateralToken, _conditionIds, _fee, _funding, marketOwner) {}


    /// @dev Calculates the net cost for executing a given trade.
    /// @param outcomeTokenAmounts Amounts of outcome tokens to buy from the market. If an amount is negative, represents an amount to sell to the market.
    /// @return Net cost of trade. If positive, represents amount of collateral which would be paid to the market for the trade. If negative, represents amount of collateral which would be received from the market for the trade.
    function calcNetCost(int[] memory outcomeTokenAmounts)
        public
        view
        returns (int netCost)
    {
        require(outcomeTokenAmounts.length == atomicOutcomeSlotCount);

        int[] memory otExpNums = new int[](atomicOutcomeSlotCount);
        for (uint i = 0; i < atomicOutcomeSlotCount; i++) {
            int balance = int(pmSystem.balanceOf(address(this), generateBasicPositionId(i)));
            require(balance >= 0);
            otExpNums[i] = outcomeTokenAmounts[i].sub(balance);
        }

        int log2N = Fixed192x64Math.binaryLog(atomicOutcomeSlotCount * ONE, Fixed192x64Math.EstimationMode.UpperBound);

        (uint sum, int offset, ) = sumExpOffset(log2N, otExpNums, 0, Fixed192x64Math.EstimationMode.UpperBound);
        netCost = Fixed192x64Math.binaryLog(sum, Fixed192x64Math.EstimationMode.UpperBound);
        netCost = netCost.add(offset);
        netCost = (netCost.mul(int(ONE)) / log2N).mul(int(funding));

        // Integer division for negative numbers already uses ceiling,
        // so only check boundary condition for positive numbers
        if(netCost <= 0 || netCost / int(ONE) * int(ONE) == netCost) {
            netCost /= int(ONE);
        } else {
            netCost = netCost / int(ONE) + 1;
        }
    }

    /// @dev Returns marginal price of an outcome
    /// @param outcomeTokenIndex Index of outcome to determine marginal price of
    /// @return Marginal price of an outcome as a fixed point number
    function calcMarginalPrice(uint8 outcomeTokenIndex)
        public
        view
        returns (uint price)
    {
        int[] memory negOutcomeTokenBalances = new int[](atomicOutcomeSlotCount);
        for (uint i = 0; i < atomicOutcomeSlotCount; i++) {
            int negBalance = -int(pmSystem.balanceOf(address(this), generateBasicPositionId(i)));
            require(negBalance <= 0);
            negOutcomeTokenBalances[i] = negBalance;
        }

        int log2N = Fixed192x64Math.binaryLog(negOutcomeTokenBalances.length * ONE, Fixed192x64Math.EstimationMode.Midpoint);
        // The price function is exp(quantities[i]/b) / sum(exp(q/b) for q in quantities)
        // To avoid overflow, calculate with
        // exp(quantities[i]/b - offset) / sum(exp(q/b - offset) for q in quantities)
        (uint sum, , uint outcomeExpTerm) = sumExpOffset(log2N, negOutcomeTokenBalances, outcomeTokenIndex, Fixed192x64Math.EstimationMode.Midpoint);
        return outcomeExpTerm / (sum / ONE);
    }

    /*
     *  Private functions
     */
    /// @dev Calculates sum(exp(q/b - offset) for q in quantities), where offset is set
    ///      so that the sum fits in 248-256 bits
    /// @param log2N Binary logarithm of the number of outcomes
    /// @param otExpNums Numerators of the exponents, denoted as q in the aforementioned formula
    /// @param outcomeIndex Index of exponential term to extract (for use by marginal price function)
    /// @return A result structure composed of the sum, the offset used, and the summand associated with the supplied index
    function sumExpOffset(int log2N, int[] memory otExpNums, uint8 outcomeIndex, Fixed192x64Math.EstimationMode estimationMode)
        private
        view
        returns (uint sum, int offset, uint outcomeExpTerm)
    {
        // Naive calculation of this causes an overflow
        // since anything above a bit over 133*ONE supplied to exp will explode
        // as exp(133) just about fits into 192 bits of whole number data.

        // The choice of this offset is subject to another limit:
        // computing the inner sum successfully.
        // Since the index is 8 bits, there has to be 8 bits of headroom for
        // each summand, meaning q/b - offset <= exponential_limit,
        // where that limit can be found with `mp.floor(mp.log((2**248 - 1) / ONE) * ONE)`
        // That is what EXP_LIMIT is set to: it is about 127.5

        // finally, if the distribution looks like [BIG, tiny, tiny...], using a
        // BIG offset will cause the tiny quantities to go really negative
        // causing the associated exponentials to vanish.

        require(log2N >= 0 && int(funding) >= 0);
        offset = Fixed192x64Math.max(otExpNums);
        offset = offset.mul(log2N) / int(funding);
        offset = offset.sub(EXP_LIMIT);
        uint term;
        for (uint8 i = 0; i < otExpNums.length; i++) {
            term = Fixed192x64Math.pow2((otExpNums[i].mul(log2N) / int(funding)).sub(offset), estimationMode);
            if (i == outcomeIndex)
                outcomeExpTerm = term;
            sum = sum.add(term);
        }
    }
}
