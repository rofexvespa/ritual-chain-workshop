// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockPrecompile {
    fallback() external {
        bool hasError = false;
        bytes memory completionData = "Great answer!";
        bytes memory somethingElse = "";
        string memory errorMessage = "";
        
        // This is ConvoHistory
        string memory storageType = "";
        string memory path = "";
        string memory secretsName = "";
        
        bytes memory actualOutput = abi.encode(
            hasError,
            completionData,
            somethingElse,
            errorMessage,
            storageType,
            path,
            secretsName
        );
        
        bytes memory returnData = abi.encode(bytes(""), actualOutput);
        
        assembly {
            return(add(returnData, 32), mload(returnData))
        }
    }
}
