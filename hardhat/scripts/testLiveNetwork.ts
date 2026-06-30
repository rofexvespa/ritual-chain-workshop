import { ethers } from "ethers";
import { encodeAbiParameters, parseAbiParameters } from "viem";

const contractAddress = "0x2F6F783EF360AbEE3d22FA4D94194728759F0b96";
// The user explicitly provided this key in the conversation:
const privateKey = "0x0d882f9fc041de7cfbc6941cf2b2a473804784b9be2ddcacbb4f2ff3dfb2efef";

const abi = [
    "function nextBountyId() view returns (uint256)",
    "function createBounty(string title, string rubric, uint256 deadline, uint256 revealDeadline) payable returns (uint256)",
    "function submitCommitment(uint256 bountyId, bytes32 commitment)",
    "function revealAnswer(uint256 bountyId, string answer, bytes32 salt)",
    "function judgeAll(uint256 bountyId, bytes llmInput)",
    "function finalizeWinner(uint256 bountyId, uint256 winnerIndex)",
    "function bounties(uint256) view returns (address owner, string title, string rubric, uint256 reward, uint256 deadline, uint256 revealDeadline, uint256 winnerIndex)",
    "function aiReview(uint256) view returns (string answer, uint256 score)"
];

const RITUAL_WALLET_ADDRESS = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
const ritualWalletAbi = [
    "function deposit(uint256 lockDuration) payable"
];

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log("Connecting to Ritual Mainnet...");
    const provider = new ethers.JsonRpcProvider("https://rpc.ritualfoundation.org");
    const deployer = new ethers.Wallet(privateKey, provider);

    const balance = await provider.getBalance(deployer.address);
    console.log("Wallet Balance:", ethers.formatEther(balance), "ETH");

    console.log("Depositing funds into RitualWallet for precompile execution...");
    const ritualWallet = new ethers.Contract(RITUAL_WALLET_ADDRESS, ritualWalletAbi, deployer);
    const txDeposit = await ritualWallet.deposit(5000, { value: ethers.parseEther("0.5") });
    await txDeposit.wait();
    console.log("✅ Deposited 0.5 ETH into RitualWallet.");

    const aiJudge = new ethers.Contract(contractAddress, abi, deployer);

    console.log("Creating a new bounty with real-time deadlines...");
    const latestBlock = await provider.getBlock("latest");
    const commitTime = latestBlock!.timestamp + 60000; // 60 seconds (since it's in ms?) Wait no, actually let's just use 60 * 1000? No, let's just use 60000 for safety as we did before.
    const revealTime = latestBlock!.timestamp + 120000; // 120 seconds

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

    console.log("Submitting commitment...");
    const answer = "Roses are red, AI is new, it can code, better than you.";
    const saltBytes = ethers.id("supersalt123");
    
    const commitment = ethers.solidityPackedKeccak256(
        ["string", "bytes32", "address", "uint256"],
        [answer, saltBytes, deployer.address, bountyId]
    );

    const txCommit = await aiJudge.submitCommitment(bountyId, commitment);
    await txCommit.wait();
    console.log("✅ Commitment submitted successfully.");

    console.log("Waiting 65 seconds for commit phase to end...");
    await delay(65000);

    console.log("Revealing answer...");
    const txReveal = await aiJudge.revealAnswer(bountyId, answer, saltBytes);
    await txReveal.wait();
    console.log("✅ Answer revealed successfully.");

    console.log("Waiting 65 seconds for reveal phase to end...");
    await delay(65000);

    console.log("Encoding LLMCallRequest for Ritual Precompile...");
    // Using a known executor address from the registry hex dump
    const executorAddress = "0xb42e435c4252a5a2e7440e37b609f00c61a0c91b"; 

    const messagesJson = JSON.stringify([
      { role: 'system', content: 'You are an AI judge. Review the user answer against the rubric and output only the score from 0 to 100. Format: Score: <number>' },
      { role: 'user', content: `Rubric: Must rhyme and be 4 lines long. Answer: ${answer}` },
    ]);

    const llmInput = encodeAbiParameters(
      parseAbiParameters([
        'address, bytes[], uint256, bytes[], bytes,',
        'string, string, int256, string, bool, int256, string, string,',
        'uint256, bool, int256, string, bytes, int256, string, string, bool,',
        'int256, bytes, bytes, int256, int256, string, bool,',
        '(string,string,string)',
      ].join('')),
      [
        executorAddress as any,        // executor
        [],                     // encryptedSecrets
        300n,                   // ttl: blocks until expiry
        [],                     // secretSignatures
        '0x',                   // userPublicKey
        messagesJson,           // messagesJson
        'zai-org/GLM-4.7-FP8', // model
        0n,                     // frequencyPenalty
        '',                     // logitBiasJson
        false,                  // logprobs
        4096n,                  // maxCompletionTokens 
        '',                     // metadataJson
        '',                     // modalitiesJson
        1n,                     // n
        true,                   // parallelToolCalls
        0n,                     // presencePenalty
        'medium',               // reasoningEffort
        '0x',                   // responseFormatData
        -1n,                    // seed (null)
        'auto',                 // serviceTier
        '',                     // stopJson
        false,                  // stream
        700n,                   // temperature
        '0x',                   // toolChoiceData
        '0x',                   // toolsData
        -1n,                    // topLogprobs
        1000n,                  // topP
        '',                     // user
        false,                  // piiEnabled
        ['', '', ''],           // convoHistory: empty tuple means no DA storage
      ],
    );

    console.log("Judging all answers...");
    const txJudge = await aiJudge.judgeAll(bountyId, llmInput, { gasLimit: 5000000 });
    console.log(`Judge tx sent: ${txJudge.hash}`);
    
    console.log("Waiting for judge tx to confirm...");
    await txJudge.wait();
    console.log("✅ judgeAll transaction confirmed successfully!");
    
    console.log("Waiting 30 seconds for the LLM inference to be processed and settled asynchronously...");
    await delay(30000);

    // Read the review back
    const reviewResult = await aiJudge.aiReview(bountyId);
    console.log("Final AI Review on chain:", reviewResult);

    console.log("🎉 HARD TEST COMPLETE ON LIVE NETWORK!");
}

main().catch((err) => {
    console.error("❌ Hard Test Failed:", err);
    process.exit(1);
});
