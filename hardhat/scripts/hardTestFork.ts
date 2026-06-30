import { createPublicClient, createWalletClient, http, toHex, encodePacked, keccak256, parseGwei, getAddress, defineChain } from "viem";

const localHardhat = defineChain({
  id: 31337,
  name: 'Hardhat Local',
  network: 'hardhat',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] }, public: { http: ['http://127.0.0.1:8545'] } },
});

const abi = [
    {
      "inputs": [{"internalType": "uint256","name": "","type": "uint256"}],
      "name": "bounties",
      "outputs": [
        {"internalType": "address","name": "owner","type": "address"},
        {"internalType": "string","name": "title","type": "string"},
        {"internalType": "string","name": "rubric","type": "string"},
        {"internalType": "uint256","name": "reward","type": "uint256"},
        {"internalType": "uint256","name": "deadline","type": "uint256"},
        {"internalType": "uint256","name": "revealDeadline","type": "uint256"},
        {"internalType": "bool","name": "judged","type": "bool"},
        {"internalType": "bool","name": "finalized","type": "bool"},
        {"internalType": "bytes","name": "aiReview","type": "bytes"},
        {"internalType": "uint256","name": "winnerIndex","type": "uint256"}
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "nextBountyId",
      "outputs": [{"internalType": "uint256","name": "","type": "uint256"}],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {"internalType": "string","name": "title","type": "string"},
        {"internalType": "string","name": "rubric","type": "string"},
        {"internalType": "uint256","name": "deadline","type": "uint256"},
        {"internalType": "uint256","name": "revealDeadline","type": "uint256"}
      ],
      "name": "createBounty",
      "outputs": [{"internalType": "uint256","name": "bountyId","type": "uint256"}],
      "stateMutability": "payable",
      "type": "function"
    },
    {
      "inputs": [
        {"internalType": "uint256","name": "bountyId","type": "uint256"},
        {"internalType": "bytes32","name": "commitment","type": "bytes32"}
      ],
      "name": "submitCommitment",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {"internalType": "uint256","name": "bountyId","type": "uint256"},
        {"internalType": "string","name": "answer","type": "string"},
        {"internalType": "bytes32","name": "salt","type": "bytes32"}
      ],
      "name": "revealAnswer",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {"internalType": "uint256","name": "bountyId","type": "uint256"},
        {"internalType": "bytes","name": "llmInput","type": "bytes"}
      ],
      "name": "judgeAll",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {"internalType": "uint256","name": "bountyId","type": "uint256"},
        {"internalType": "uint256","name": "winnerIndex","type": "uint256"}
      ],
      "name": "finalizeWinner",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    }
];

async function main() {
    console.log("Starting Hard Test on Forked Network...");
    
    const transport = http("http://127.0.0.1:8545");
    const publicClient = createPublicClient({ transport, chain: localHardhat });
    
    // Get test accounts
    const addresses = await publicClient.request({ method: "eth_accounts" }) as `0x${string}`[];
    const deployer = getAddress(addresses[0]);
    const user1 = getAddress(addresses[1]);
    
    const walletClient = createWalletClient({ account: deployer, transport, chain: localHardhat });
    const userWalletClient = createWalletClient({ account: user1, transport, chain: localHardhat });

    const contractAddress = getAddress("0x2F6F783EF360AbEE3d22FA4D94194728759F0b96");
    
    const nextBountyIdBefore = await publicClient.readContract({
        address: contractAddress,
        abi,
        functionName: "nextBountyId"
    });
    console.log(`✅ Connected to deployed AIJudge. Current nextBountyId: ${nextBountyIdBefore}`);

    console.log("Creating a new bounty...");
    const currentBlock = await publicClient.getBlock();
    const commitTime = currentBlock.timestamp + 100n;
    const revealTime = currentBlock.timestamp + 200n;

    const { request: createReq } = await publicClient.simulateContract({
        account: deployer,
        address: contractAddress,
        abi,
        functionName: "createBounty",
        args: ["Write a poem about AI", "Must rhyme and be 4 lines long", commitTime, revealTime],
        value: parseGwei("10")
    });
    const txCreate = await walletClient.writeContract(createReq);
    await publicClient.waitForTransactionReceipt({ hash: txCreate });
    
    const bountyId = (await publicClient.readContract({
        address: contractAddress, abi, functionName: "nextBountyId"
    }) as bigint) - 1n;
    console.log(`✅ Bounty ${bountyId} created successfully.`);

    console.log("User 1 submitting commitment...");
    const answer = "Roses are red, AI is new, it can code, better than you.";
    const saltString = "supersalt123";
    const saltBytes = toHex(saltString, { size: 32 });
    
    const commitment = keccak256(
        encodePacked(
            ["string", "bytes32", "address", "uint256"],
            [answer, saltBytes, user1, bountyId]
        )
    );

    const { request: commitReq } = await publicClient.simulateContract({
        account: user1, address: contractAddress, abi, functionName: "submitCommitment", args: [bountyId, commitment]
    });
    const txCommit = await userWalletClient.writeContract(commitReq);
    await publicClient.waitForTransactionReceipt({ hash: txCommit });
    console.log("✅ Commitment submitted successfully.");

    console.log("Fast-forwarding time to reveal phase...");
    await publicClient.request({ method: "evm_increaseTime", params: [150] } as any);
    await publicClient.request({ method: "evm_mine" } as any);

    console.log("User 1 revealing answer...");
    const { request: revealReq } = await publicClient.simulateContract({
        account: user1, address: contractAddress, abi, functionName: "revealAnswer", args: [bountyId, answer, saltBytes]
    });
    const txReveal = await userWalletClient.writeContract(revealReq);
    await publicClient.waitForTransactionReceipt({ hash: txReveal });
    console.log("✅ Answer revealed successfully.");

    console.log("Fast-forwarding past reveal deadline...");
    await publicClient.request({ method: "evm_increaseTime", params: [150] } as any);
    await publicClient.request({ method: "evm_mine" } as any);

    console.log("Deploying Mock Precompile for AI Inference...");
    const fs = require("fs");
    const path = require("path");
    const mockPrecompileJsonPath = path.join(__dirname, "..", "artifacts", "contracts", "MockPrecompile.sol", "MockPrecompile.json");
    if (!fs.existsSync(mockPrecompileJsonPath)) {
        throw new Error("MockPrecompile artifact not found. Did you compile?");
    }
    const mockPrecompileJson = JSON.parse(fs.readFileSync(mockPrecompileJsonPath, "utf-8"));
    const mockBytecode = mockPrecompileJson.deployedBytecode;
    
    await publicClient.request({
        method: "hardhat_setCode",
        params: ["0x0000000000000000000000000000000000000802", mockBytecode]
    } as any);
    console.log("✅ Precompile mocked at 0x0802.");

    console.log("Judging all answers...");
    const llmInput = toHex("test input");
    const { request: judgeReq } = await publicClient.simulateContract({
        account: deployer, address: contractAddress, abi, functionName: "judgeAll", args: [bountyId, llmInput]
    });
    const txJudge = await walletClient.writeContract(judgeReq);
    await publicClient.waitForTransactionReceipt({ hash: txJudge });
    console.log("✅ All answers judged successfully.");

    console.log("Finalizing winner...");
    const { request: finalizeReq } = await publicClient.simulateContract({
        account: deployer, address: contractAddress, abi, functionName: "finalizeWinner", args: [bountyId, 0n]
    });
    const txFinalize = await walletClient.writeContract(finalizeReq);
    await publicClient.waitForTransactionReceipt({ hash: txFinalize });
    
    console.log("🎉 HARD TEST COMPLETE. The deployed contract workflow executed perfectly on the mainnet fork!");
}

main().catch((error) => {
    console.error("❌ Hard Test Failed:", error);
    process.exitCode = 1;
});
