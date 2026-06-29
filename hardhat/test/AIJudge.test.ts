import { describe, it } from "node:test";
import { expect } from "chai";
import hre from "hardhat";
import { toHex, encodePacked, keccak256, parseGwei } from "viem";

describe("AIJudge Commit-Reveal Flow", function () {
    async function deployFixture() {
        const publicClient = await hre.viem.getPublicClient();
        const [owner, addr1, addr2] = await hre.viem.getWalletClients();
        const aiJudge = await hre.viem.deployContract("AIJudge");
        return { aiJudge, owner, addr1, addr2, publicClient };
    }

    it("should allow a valid commit and reveal", async function () {
        const { aiJudge, addr1, publicClient } = await deployFixture();

        const answer = 42n; // BigInt
        const saltStr = "random_salt_123";
        const saltBytes = keccak256(toHex(saltStr));

        // Create the commitment hash locally to match Solidity's keccak256(abi.encodePacked(answer, salt))
        const commitment = keccak256(encodePacked(['uint256', 'bytes32'], [answer, saltBytes]));

        // Commit
        const txCommit = await aiJudge.write.commit([commitment], { account: addr1.account });
        await publicClient.waitForTransactionReceipt({ hash: txCommit });

        const commitBlock = await publicClient.getBlock();
        const commitTime = commitBlock.timestamp;

        // Check if the commit is stored
        const userCommit = await aiJudge.read.commits([addr1.account.address]);
        expect(userCommit[0]).to.equal(commitment);

        // Fast forward time to bypass commit phase
        await hre.network.provider.send("evm_increaseTime", [600]); // 10 minutes later
        await hre.network.provider.send("evm_mine");

        // Reveal
        const txReveal = await aiJudge.write.reveal([answer, saltBytes], { account: addr1.account });
        await publicClient.waitForTransactionReceipt({ hash: txReveal });

        // Verify the reveal was successful
        const revealData = await aiJudge.read.reveals([addr1.account.address]);
        expect(revealData[0]).to.equal(answer);
        expect(revealData[1]).to.equal(saltBytes);
    });

    it("should fail reveal if salt or answer is wrong", async function () {
        const { aiJudge, addr1, publicClient } = await deployFixture();

        const answer = 42n;
        const saltBytes = keccak256(toHex("random_salt_123"));
        const commitment = keccak256(encodePacked(['uint256', 'bytes32'], [answer, saltBytes]));

        // Commit
        const txCommit = await aiJudge.write.commit([commitment], { account: addr1.account });
        await publicClient.waitForTransactionReceipt({ hash: txCommit });

        // Fast forward time
        await hre.network.provider.send("evm_increaseTime", [600]);
        await hre.network.provider.send("evm_mine");

        // Attempt to reveal with WRONG answer
        let errorOccurred = false;
        try {
            await aiJudge.write.reveal([43n, saltBytes], { account: addr1.account });
        } catch (error) {
            errorOccurred = true;
        }
        expect(errorOccurred).to.be.true;
    });

    it("should prevent committing after deadline and revealing before deadline", async function () {
        const { aiJudge, addr1, publicClient } = await deployFixture();

        const answer = 42n;
        const saltBytes = keccak256(toHex("random_salt_123"));
        const commitment = keccak256(encodePacked(['uint256', 'bytes32'], [answer, saltBytes]));

        // Try revealing BEFORE deadline
        let errorRevealBeforeDeadline = false;
        try {
            await aiJudge.write.reveal([answer, saltBytes], { account: addr1.account });
        } catch (error) {
            errorRevealBeforeDeadline = true;
        }
        expect(errorRevealBeforeDeadline).to.be.true;

        // Fast forward past the commit deadline
        await hre.network.provider.send("evm_increaseTime", [600]);
        await hre.network.provider.send("evm_mine");

        // Try committing AFTER deadline
        let errorCommitAfterDeadline = false;
        try {
            await aiJudge.write.commit([commitment], { account: addr1.account });
        } catch (error) {
            errorCommitAfterDeadline = true;
        }
        expect(errorCommitAfterDeadline).to.be.true;
    });
});
