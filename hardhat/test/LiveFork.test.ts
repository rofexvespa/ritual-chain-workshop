import { describe, it } from "node:test";
import assert from "node:assert";
import hre from "hardhat";

describe("Live Contract Hard Test on Fork", () => {
    it("should successfully execute a full workflow on the deployed contract", async () => {
        const [deployer, user1] = await hre.ethers.getSigners();
        const contractAddress = "0x2F6F783EF360AbEE3d22FA4D94194728759F0b96";
        
        const aiJudge = await hre.ethers.getContractAt("AIJudge", contractAddress, deployer);
        const aiJudgeUser = await hre.ethers.getContractAt("AIJudge", contractAddress, user1);

        const nextBountyIdBefore = await aiJudge.nextBountyId();
        console.log(`✅ Connected to deployed AIJudge. Current nextBountyId: ${nextBountyIdBefore}`);

        console.log("Creating a new bounty...");
        const latestBlock = await hre.ethers.provider.getBlock("latest");
        const commitTime = latestBlock!.timestamp + 100;
        const revealTime = latestBlock!.timestamp + 200;

        const txCreate = await aiJudge.createBounty(
            "Write a poem about AI",
            "Must rhyme and be 4 lines long",
            commitTime,
            revealTime,
            { value: hre.ethers.parseEther("0.00000001") } // 10 gwei
        );
        await txCreate.wait();
        
        const bountyId = (await aiJudge.nextBountyId()) - 1n;
        console.log(`✅ Bounty ${bountyId} created successfully.`);

        console.log("User 1 submitting commitment...");
        const answer = "Roses are red, AI is new, it can code, better than you.";
        const saltBytes = hre.ethers.id("supersalt123");
        
        const commitment = hre.ethers.solidityPackedKeccak256(
            ["string", "bytes32", "address", "uint256"],
            [answer, saltBytes, user1.address, bountyId]
        );

        const txCommit = await aiJudgeUser.submitCommitment(bountyId, commitment);
        await txCommit.wait();
        console.log("✅ Commitment submitted successfully.");

        console.log("Fast-forwarding time to reveal phase...");
        await hre.network.provider.send("evm_increaseTime", [150]);
        await hre.network.provider.send("evm_mine");

        console.log("User 1 revealing answer...");
        const txReveal = await aiJudgeUser.revealAnswer(bountyId, answer, saltBytes);
        await txReveal.wait();
        console.log("✅ Answer revealed successfully.");

        console.log("Fast-forwarding past reveal deadline...");
        await hre.network.provider.send("evm_increaseTime", [150]);
        await hre.network.provider.send("evm_mine");

        console.log("Deploying Mock Precompile for AI Inference...");
        const MockPrecompileArtifact = await hre.artifacts.readArtifact("MockPrecompile");
        await hre.network.provider.send("hardhat_setCode", [
            "0x0000000000000000000000000000000000000802", // LLM_INFERENCE_PRECOMPILE
            MockPrecompileArtifact.deployedBytecode
        ]);
        console.log("✅ Precompile mocked at 0x0802.");

        console.log("Judging all answers...");
        const llmInput = hre.ethers.hexlify(hre.ethers.toUtf8Bytes("test input"));
        const txJudge = await aiJudge.judgeAll(bountyId, llmInput);
        await txJudge.wait();
        console.log("✅ All answers judged successfully.");

        console.log("Finalizing winner...");
        const txFinalize = await aiJudge.finalizeWinner(bountyId, 0);
        await txFinalize.wait();
        
        console.log("🎉 HARD TEST COMPLETE. The deployed contract workflow executed perfectly on the mainnet fork!");
        assert.ok(true);
    });
});
