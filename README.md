# Privacy-Preserving AI Bounty Judge

This repository contains the solution for the "Privacy-Preserving AI Bounty Judge" assignment. It implements a secure Commit-Reveal flow to prevent front-running and idea theft during bounty submissions.

## Modifications Made (Required Track)

The `AIJudge.sol` contract was updated to use a **Commit-Reveal Scheme**:
1. **Submit Phase**: Participants submit a `bytes32 commitment` instead of their plaintext answer. The commitment is generated using `keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId))`.
2. **Reveal Phase**: After the submission deadline passes, the reveal phase begins. Participants submit their plaintext `answer` and `salt`.
3. **Verification**: The contract hashes the revealed answer and salt with the `msg.sender` and `bountyId`. If it matches the stored commitment, the answer is recorded.
4. **Time Constraints**: Hard deadlines are enforced. Commitments are rejected after the deadline, and reveals are rejected before the deadline.

## Running Tests

Tests have been updated to reflect the new commit-reveal flow.

```bash
cd hardhat
npm install
npx hardhat test
```

## Architecture Note (Advanced Track: Confidential Computing TEE)

Building upon the Commit-Reveal foundation, integrating a Trusted Execution Environment (TEE) can make the evaluation completely hidden.

### How answers remain private
Instead of revealing the plaintext answer directly to the smart contract, the participant securely transmits the `answer` and `salt` over a secure channel (e.g., TLS) directly to an off-chain AI node running inside a TEE (like Intel SGX or AWS Nitro Enclaves). 

The smart contract never sees the plaintext answer. It only holds the original commitment hash.

### Verification of secure processing
The TEE provides a cryptographic **attestation report**. This report proves to anyone (including the smart contract) that a specific, untampered AI model is running inside a secure enclave and that it executed the evaluation logic correctly. The participant can verify this attestation before sending their private answer.

### Returning results without exposing raw answers
Once the TEE finishes evaluating the answer against the rubric, it generates an AI score. 
The TEE then constructs a transaction containing:
1. The `bountyId`
2. The `participant` address
3. The `AI score`
4. A cryptographic proof (attestation signature) that this result came from the secure enclave.

The TEE submits this transaction to the smart contract. The smart contract verifies the enclave's signature to trust the score, and updates the bounty state, all without ever seeing the raw answer that produced the score.

## Reflection Question

**What should be public, what should stay hidden, and what should be decided by AI versus by a human in a bounty system?**

In a privacy-preserving bounty system, the existence of a submission (the commitment hash) and the bounty parameters must be public to ensure transparency and accountability. However, the actual plaintext answers and the salt must stay hidden until the submission period ends to prevent plagiarism and idea theft. Once the deadline passes, the answers are revealed to the AI judge, but could still remain hidden from the general public if desired (as in the Advanced Track using TEEs). The AI is best suited for deciding objective validity, technical accuracy, and adherence to the rubric to ensure a fast and unbiased evaluation process. Conversely, humans should be responsible for deciding the initial bounty requirements, configuring the AI's prompt, and handling final resolutions for any disputes or highly subjective edge cases that the AI flags as ambiguous.
