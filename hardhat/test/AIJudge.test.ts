import { expect } from "chai";
import hre from "hardhat";
import { describe, it } from "node:test";

describe("AIJudge Commit-Reveal Flow", function () {
    async function deployFixture() {
        const [owner, addr1, addr2] = await hre.ethers.getSigners();
        const AIJudgeFactory = await hre.ethers.getContractFactory("AIJudge");
        const aiJudge = await AIJudgeFactory.deploy();
        return { aiJudge, owner, addr1, addr2 };
    }

    it("should allow a valid commit and reveal", async function () {
        const { aiJudge, addr1 } = await deployFixture();
        
        const title = "Best Code";
        const rubric = "Clean and fast";
        const latestBlock = await hre.ethers.provider.getBlock("latest");
        const currentTimestamp = latestBlock ? latestBlock.timestamp : Math.floor(Date.now() / 1000);
        const deadline = currentTimestamp + 3600; // 1 hour
        const revealDeadline = deadline + 3600; // 2 hours
        const reward = hre.ethers.parseEther("1");

        // 1. Create Bounty
        await aiJudge.createBounty(title, rubric, deadline, revealDeadline, { value: reward });
        const bountyId = 1;

        // 2. Commit Phase
        const answer = "My secret answer";
        const salt = hre.ethers.encodeBytes32String("my-secret-salt");
        
        // keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId))
        const encodedData = hre.ethers.solidityPacked(
            ["string", "bytes32", "address", "uint256"],
            [answer, salt, addr1.address, bountyId]
        );
        const commitment = hre.ethers.keccak256(encodedData);

        await aiJudge.connect(addr1).submitCommitment(bountyId, commitment);

        // 3. Move time to Reveal Phase
        await hre.network.provider.send("evm_increaseTime", [3660]);
        await hre.network.provider.send("evm_mine");

        // 4. Reveal Phase
        await aiJudge.connect(addr1).revealAnswer(bountyId, answer, salt);

        // 5. Verify Submission was recorded
        const submission = await aiJudge.getSubmission(bountyId, 0);
        expect(submission[0]).to.equal(addr1.address);
        expect(submission[1]).to.equal(answer);
    });

    it("should fail reveal if salt or answer is wrong", async function () {
        const { aiJudge, addr1 } = await deployFixture();

        const title = "Best Code";
        const rubric = "Clean and fast";
        const latestBlock = await hre.ethers.provider.getBlock("latest");
        const currentTimestamp = latestBlock ? latestBlock.timestamp : Math.floor(Date.now() / 1000);
        const deadline = currentTimestamp + 3600;
        const revealDeadline = deadline + 3600;
        const reward = hre.ethers.parseEther("1");

        await aiJudge.createBounty(title, rubric, deadline, revealDeadline, { value: reward });
        const bountyId = 1;

        const answer = "My secret answer";
        const salt = hre.ethers.encodeBytes32String("my-secret-salt");
        
        const encodedData = hre.ethers.solidityPacked(
            ["string", "bytes32", "address", "uint256"],
            [answer, salt, addr1.address, bountyId]
        );
        const commitment = hre.ethers.keccak256(encodedData);

        await aiJudge.connect(addr1).submitCommitment(bountyId, commitment);

        await hre.network.provider.send("evm_increaseTime", [3660]);
        await hre.network.provider.send("evm_mine");

        const wrongSalt = hre.ethers.encodeBytes32String("wrong-salt");
        await expect(
            aiJudge.connect(addr1).revealAnswer(bountyId, answer, wrongSalt)
        ).to.be.revertedWith("invalid reveal");

        const wrongAnswer = "Wrong answer";
        await expect(
            aiJudge.connect(addr1).revealAnswer(bountyId, wrongAnswer, salt)
        ).to.be.revertedWith("invalid reveal");
    });

    it("should prevent committing after deadline and revealing before deadline", async function () {
        const { aiJudge, addr1 } = await deployFixture();

        const title = "Best Code";
        const rubric = "Clean and fast";
        const latestBlock = await hre.ethers.provider.getBlock("latest");
        const currentTimestamp = latestBlock ? latestBlock.timestamp : Math.floor(Date.now() / 1000);
        const deadline = currentTimestamp + 3600;
        const revealDeadline = deadline + 3600;
        const reward = hre.ethers.parseEther("1");

        await aiJudge.createBounty(title, rubric, deadline, revealDeadline, { value: reward });
        const bountyId = 1;

        const answer = "My secret answer";
        const salt = hre.ethers.encodeBytes32String("my-secret-salt");
        const encodedData = hre.ethers.solidityPacked(
            ["string", "bytes32", "address", "uint256"],
            [answer, salt, addr1.address, bountyId]
        );
        const commitment = hre.ethers.keccak256(encodedData);

        // Try to reveal before deadline
        await expect(
            aiJudge.connect(addr1).revealAnswer(bountyId, answer, salt)
        ).to.be.revertedWith("submission phase still active");

        // Move to after deadline
        await hre.network.provider.send("evm_increaseTime", [3660]);
        await hre.network.provider.send("evm_mine");

        // Try to commit after deadline
        await expect(
            aiJudge.connect(addr1).submitCommitment(bountyId, commitment)
        ).to.be.revertedWith("submission phase ended");
    });
});
