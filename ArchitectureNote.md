# Architecture Note: Commit-Reveal vs. Ritual-Native Encrypted Submissions

In designing a privacy-preserving AI Bounty Judge, we are confronted with the challenge of preventing "answer copying" while still utilizing an open, public ledger. Two primary architectural approaches can solve this: the **Commit-Reveal Scheme** (implemented in our `AIJudge.sol`) and **Ritual-Native Encrypted Submissions** (the Advanced Track approach utilizing Trusted Execution Environments). 

Below is a technical comparison of the two paradigms.

---

## 1. Commit-Reveal (Layer 1 EVM Approach)

This approach relies on cryptographic hashing to prove knowledge of an answer without revealing it until a specified time.

### How it Works:
- **Commit Phase:** Participants submit a `keccak256` hash of their `(answer, salt, msg.sender, bountyId)` to the blockchain. The actual plaintext is kept locally by the participant.
- **Reveal Phase:** After the submission deadline, participants broadcast their plaintext `answer` and `salt`.
- **Validation:** The smart contract hashes the revealed data and verifies it matches the stored commitment. Valid answers are pushed to the AI evaluation queue.

### Where Plaintext Exists:
- **Before Reveal:** Only on the participant's local machine. The blockchain only sees a 32-byte hash.
- **After Reveal:** On-chain, in plaintext `calldata`, readable by anyone syncing the blockchain.

### Storage Profile:
- **On-chain:** A 32-byte hash (Commitment) and later the full plaintext string (Reveal).
- **Off-chain:** None required (unless storing the plaintext answer in IPFS to save gas, storing only the CID on-chain).

### Pros & Cons:
- **Pros:** Decentralized, trustless, relies purely on cryptography and EVM state. No special hardware required.
- **Cons:** Participants *must* return to the dApp to reveal their answers. If they forget, their submission is lost. Additionally, once revealed, the answers become public *before* the AI judges them.

---

## 2. Ritual-Native Encrypted Submissions (TEE / Advanced Track)

This approach leverages Ritual's integration with Trusted Execution Environments (TEEs) to keep data encrypted both at rest and in transit, decrypting it only inside a secure enclave during AI execution.

### Where Plaintext Exists & Who Can Read It:
- **Before Judging:** Plaintext exists only on the participant's local machine and inside the TEE enclave memory during execution. No one else, not even the node operator, can read it.
- **After Judging:** Still strictly hidden. It is never stored on the public blockchain.

### Storage Profile (On-chain vs Off-chain):
- **On-chain:** Only the encrypted ciphertext (or a reference like an IPFS CID pointing to it). 
- **Off-chain:** The encrypted payload (if using IPFS) and the TEE memory during execution. To avoid massive gas costs, large plaintext answers are *never* stored directly on-chain.

### How the LLM Receives All Submissions Together:
Instead of calling the LLM inside a Solidity loop for each submission, the smart contract triggers `judgeAll`. The TEE-based workflow reads all encrypted submissions, decrypts them privately inside the enclave, bundles them into a single array (a batch), and sends them in one large prompt to the LLM for comparison. 

### How the Final Reveal Happens:
After judging, instead of revealing all plaintext answers directly into contract storage, the TEE bundles the answers and the winner's index, uploads this bundle to decentralized off-chain storage (like IPFS/Arweave), and generates a hash of this bundle.

### How the Contract Verifies or Commits to the Final Revealed Bundle:
The TEE submits a cryptographic attestation signature back to the smart contract containing the `winnerIndex`, `revealedAnswersRef` (e.g., IPFS CID), and the `revealedAnswersHash`. The smart contract verifies the enclave's signature to ensure the payload is authentic. It then stores the `revealedAnswersHash` on-chain, definitively committing to the final bundle and allowing anyone to verify the off-chain data's integrity without clogging the blockchain with plaintext.

---

## Conclusion
For a standard EVM deployment, **Commit-Reveal** is the most robust, decentralized solution to prevent front-running. However, for true zero-knowledge bounties where proprietary intellectual property must remain secret indefinitely, a **Ritual-Native TEE** architecture is the superior, enterprise-grade choice.
