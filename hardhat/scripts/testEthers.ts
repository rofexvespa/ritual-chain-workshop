import { ethers } from "ethers";

const contractAddress = "0x2F6F783EF360AbEE3d22FA4D94194728759F0b96";

const abi = [
    "function nextBountyId() view returns (uint256)",
    "function createBounty(string title, string rubric, uint256 deadline, uint256 revealDeadline) payable returns (uint256)",
    "function submitCommitment(uint256 bountyId, bytes32 commitment)",
    "function revealAnswer(uint256 bountyId, string answer, bytes32 salt)",
    "function judgeAll(uint256 bountyId, bytes llmInput)",
    "function finalizeWinner(uint256 bountyId, uint256 winnerIndex)"
];

async function main() {
    console.log("Connecting to local forked node...");
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    
    const signers = await provider.listAccounts();
    const deployer = await provider.getSigner(signers[0].address);
    const user1 = await provider.getSigner(signers[1].address);

    const aiJudge = new ethers.Contract(contractAddress, abi, deployer);
    const aiJudgeUser = new ethers.Contract(contractAddress, abi, user1);

    const nextBountyIdBefore = await aiJudge.nextBountyId();
    console.log(`✅ Connected to deployed AIJudge. Current nextBountyId: ${nextBountyIdBefore}`);

    console.log("Creating a new bounty...");
    const latestBlock = await provider.getBlock("latest");
    const commitTime = latestBlock!.timestamp + 100;
    const revealTime = latestBlock!.timestamp + 200;

    const txCreate = await aiJudge.createBounty(
        "Write a poem about AI",
        "Must rhyme and be 4 lines long",
        commitTime,
        revealTime,
        { value: ethers.parseEther("0.00000001") } // 10 gwei
    );
    await txCreate.wait();
    
    const bountyId = (await aiJudge.nextBountyId()) - 1n;
    console.log(`✅ Bounty ${bountyId} created successfully.`);

    console.log("User 1 submitting commitment...");
    const answer = "Roses are red, AI is new, it can code, better than you.";
    const saltBytes = ethers.id("supersalt123");
    
    const commitment = ethers.solidityPackedKeccak256(
        ["string", "bytes32", "address", "uint256"],
        [answer, saltBytes, user1.address, bountyId]
    );

    const txCommit = await aiJudgeUser.submitCommitment(bountyId, commitment);
    await txCommit.wait();
    console.log("✅ Commitment submitted successfully.");

    console.log("Fast-forwarding time to reveal phase...");
    await provider.send("evm_increaseTime", [150]);
    await provider.send("evm_mine", []);

    console.log("User 1 revealing answer...");
    const txReveal = await aiJudgeUser.revealAnswer(bountyId, answer, saltBytes);
    await txReveal.wait();
    console.log("✅ Answer revealed successfully.");

    console.log("Fast-forwarding past reveal deadline...");
    await provider.send("evm_increaseTime", [150]);
    await provider.send("evm_mine", []);

    console.log("Deploying Mock Precompile for AI Inference...");
    // We can just use hardhat to read the artifact, or inline the bytecode if we want.
    // Wait, since we are outside hardhat, let's just use fetch or fs to read it!
    const fs = require("fs");
    const path = require("path");
    const artifactPath = path.join(__dirname, "../artifacts/contracts/MockPrecompile.sol/MockPrecompile.json");
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const bytecode = artifact.deployedBytecode;
    
    await provider.send("hardhat_setCode", [
        "0x0000000000000000000000000000000000000802", // LLM_INFERENCE_PRECOMPILE
        bytecode
    ]);
    console.log("✅ Precompile mocked at 0x0802.");

    console.log("Judging all answers...");
    const llmInput = ethers.hexlify(ethers.toUtf8Bytes("test input"));
    const txJudge = await aiJudge.judgeAll(bountyId, llmInput);
    await txJudge.wait();
    console.log("✅ All answers judged successfully.");

    console.log("Finalizing winner...");
    const txFinalize = await aiJudge.finalizeWinner(bountyId, 0);
    await txFinalize.wait();
    
    console.log("🎉 HARD TEST COMPLETE. The deployed contract workflow executed perfectly on the mainnet fork!");
}

main().catch((err) => {
    console.error("❌ Hard Test Failed:", err);
    process.exit(1);
});
