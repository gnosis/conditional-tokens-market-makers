pragma solidity ^0.5.1;

import 'openzeppelin-solidity/contracts/ownership/Ownable.sol'; 

/// @title Whitelist for adding/removing users from a whitelist
/// @author Anton Shtylman - @InfiniteStyles
contract Whitelist is Ownable {

  event UsersAddedToWhitelist(address[] users);
  event UsersRemovedFromWhitelist(address[] users);

  mapping(address => bool) public userWhitelist;

  function addToWhitelist(address[] calldata users) onlyOwner external {
    for (uint i = 0; i < users.length; i++) {
      userWhitelist[users[i]] = true;
    }
    emit UsersAddedToWhitelist(users);
  }

  function removeFromWhitelist(address[] calldata users) onlyOwner external {
    for (uint i = 0; i < users.length; i++) {
      userWhitelist[users[i]] = false;
    }
    emit UsersRemovedFromWhitelist(users);
  }

  function isWhitelisted(address user) view public returns (bool) {
    return userWhitelist[user];
  }
}
