pragma solidity >=0.4.24 ^0.5.1;

contract Create2CloneFactory {

    event CloneCreated(address indexed target, address clone);
    
    function cloneConstructor(bytes calldata) external;

    function create2Clone(address target, uint saltNonce, bytes memory consData) internal returns (address result) {
        bytes memory consPayload = abi.encodeWithSignature("cloneConstructor(bytes)", consData);
        bytes memory clone = new bytes(consPayload.length + 99);

        assembly {
            mstore(add(clone, 0x20),
                0x3d3d606380380380913d393d73bebebebebebebebebebebebebebebebebebebe)
            mstore(add(clone, 0x2d),
                mul(address, 0x01000000000000000000000000))
            mstore(add(clone, 0x41),
                0x5af4602a57600080fd5b602d8060366000396000f3363d3d373d3d3d363d73be)
            mstore(add(clone, 0x60),
                mul(target, 0x01000000000000000000000000))
            mstore(add(clone, 116),
                0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
        }

        for(uint i = 0; i < consPayload.length; i++) {
            clone[99 + i] = consPayload[i];
        }

        bytes32 salt = keccak256(abi.encode(msg.sender, saltNonce));

        assembly {
          let len := mload(clone)
          let data := add(clone, 0x20)
          result := create2(0, data, len, salt)
        }
        
        require(result != address(0), "create2 failed");
    }
}
