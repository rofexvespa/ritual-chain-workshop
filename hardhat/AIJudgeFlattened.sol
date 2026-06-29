// Sources flattened with hardhat v3.9.0 https://hardhat.org

// SPDX-License-Identifier: MIT

// File contracts/utils/PrecompileConsumer.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.20;

abstract contract PrecompileConsumer {
    // Synchronous precompiles
    address internal constant ONNX_PRECOMPILE = address(0x0800);
    address internal constant JQ_PRECOMPILE = address(0x0803);
    address internal constant ED25519_PRECOMPILE = address(0x0009);
    address internal constant SECP256R1_PRECOMPILE = address(0x0100);
    address internal constant TX_HASH_PRECOMPILE = address(0x0830);

    // Short-running async precompiles
    address internal constant HTTP_CALL_PRECOMPILE = address(0x0801);
    address internal constant LLM_INFERENCE_PRECOMPILE = address(0x0802);
    address internal constant DKMS_PRECOMPILE = address(0x081B);

    // Long-running async precompiles
    address internal constant LONG_HTTP_PRECOMPILE = address(0x0805);
    address internal constant ZK_TWO_PHASE_PRECOMPILE = address(0x0806);
    address internal constant FHE_PRECOMPILE = address(0x0807);
    address internal constant SOVEREIGN_AGENT_PRECOMPILE = address(0x080C);
    address internal constant IMAGE_CALL_PRECOMPILE = address(0x0818);
    address internal constant AUDIO_CALL_PRECOMPILE = address(0x0819);
    address internal constant VIDEO_CALL_PRECOMPILE = address(0x081A);
    address internal constant PERSISTENT_AGENT_PRECOMPILE = address(0x0820);

    // System contracts
    address internal constant ASYNC_DELIVERY =
        0x5A16214fF555848411544b005f7Ac063742f39F6;

    function _executePrecompile(
        address precompile,
        bytes memory input
    ) internal returns (bytes memory) {
        (bool success, bytes memory rawOutput) = precompile.call(input);

        if (!success) {
            assembly {
                revert(add(rawOutput, 32), mload(rawOutput))
            }
        }

        // Short-running async precompiles return:
        // abi.encode(bytes simmedInput, bytes actualOutput)
        if (
            precompile == HTTP_CALL_PRECOMPILE ||
            precompile == LLM_INFERENCE_PRECOMPILE ||
            precompile == DKMS_PRECOMPILE
        ) {
            (, bytes memory actualOutput) = abi.decode(
                rawOutput,
                (bytes, bytes)
            );
            return actualOutput;
        }

        return rawOutput;
    }

    function callSECP256R1SigVer(
        bytes memory input
    ) internal view returns (bytes memory) {
        (bool success, bytes memory result) = SECP256R1_PRECOMPILE.staticcall(
            input
        );

        require(success, "SECP256R1 precompile failed");
        return result;
    }
}


// File contracts/AIJudge.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.24;
interface IRitualWallet {
    function deposit(uint256 lockDuration) external payable;

    function depositFor(address user, uint256 lockDuration) external payable;

    function withdraw(uint256 amount) external;

    function balanceOf(address) external view returns (uint256);

    function lockUntil(address) external view returns (uint256);
}

contract AIJudge is PrecompileConsumer {
    uint256 public constant MAX_SUBMISSIONS = 10;
    uint256 public constant MAX_ANSWER_LENGTH = 2_000;

    uint256 public nextBountyId = 1;

    IRitualWallet wallet =
        IRitualWallet(0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948);

    struct Submission {
        address submitter;
        string answer;
    }

    struct Bounty {
        address owner;
        string title;
        string rubric;
        uint256 reward;
        uint256 deadline;
        uint256 revealDeadline;
        bool judged;
        bool finalized;
        bytes aiReview;
        uint256 winnerIndex;
        Submission[] submissions;
    }

    struct ConvoHistory {
        string storageType;
        string path;
        string secretsName;
    }

    mapping(uint256 => Bounty) public bounties;
    mapping(uint256 => mapping(address => bytes32)) public commitments;
    mapping(uint256 => mapping(address => bool)) public hasRevealed;

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed owner,
        string title,
        uint256 reward,
        uint256 deadline,
        uint256 revealDeadline
    );

    event CommitmentSubmitted(
        uint256 indexed bountyId,
        address indexed submitter,
        bytes32 commitment
    );

    event AnswerRevealed(
        uint256 indexed bountyId,
        address indexed submitter
    );

    event AllAnswersJudged(uint256 indexed bountyId, bytes aiReview);

    event WinnerFinalized(
        uint256 indexed bountyId,
        uint256 indexed winnerIndex,
        address indexed winner,
        uint256 reward
    );

    modifier onlyOwner(uint256 bountyId) {
        require(msg.sender == bounties[bountyId].owner, "not bounty owner");
        _;
    }

    modifier bountyExists(uint256 bountyId) {
        require(bounties[bountyId].owner != address(0), "bounty not found");
        _;
    }

    function createBounty(
        string calldata title,
        string calldata rubric,
        uint256 deadline,
        uint256 revealDeadline
    ) external payable returns (uint256 bountyId) {
        require(msg.value > 0, "reward required");
        require(revealDeadline > deadline, "reveal must be after deadline");

        bountyId = nextBountyId++;

        Bounty storage bounty = bounties[bountyId];

        bounty.owner = msg.sender;
        bounty.title = title;
        bounty.rubric = rubric;
        bounty.reward = msg.value;
        bounty.deadline = deadline;
        bounty.revealDeadline = revealDeadline;
        bounty.winnerIndex = type(uint256).max;

        emit BountyCreated(bountyId, msg.sender, title, msg.value, deadline, revealDeadline);
    }

    function submitCommitment(
        uint256 bountyId,
        bytes32 commitment
    ) external bountyExists(bountyId) {
        Bounty storage bounty = bounties[bountyId];
        require(block.timestamp <= bounty.deadline, "submission phase ended");
        require(commitments[bountyId][msg.sender] == bytes32(0), "already committed");

        commitments[bountyId][msg.sender] = commitment;

        emit CommitmentSubmitted(bountyId, msg.sender, commitment);
    }

    function revealAnswer(
        uint256 bountyId,
        string calldata answer,
        bytes32 salt
    ) external bountyExists(bountyId) {
        Bounty storage bounty = bounties[bountyId];
        
        require(block.timestamp > bounty.deadline, "submission phase still active");
        require(block.timestamp <= bounty.revealDeadline, "reveal phase ended");
        require(!hasRevealed[bountyId][msg.sender], "already revealed");
        require(bounty.submissions.length < MAX_SUBMISSIONS, "too many submissions");
        require(bytes(answer).length <= MAX_ANSWER_LENGTH, "answer too long");

        bytes32 commitment = commitments[bountyId][msg.sender];
        require(commitment != bytes32(0), "no commitment found");
        require(
            keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId)) == commitment,
            "invalid reveal"
        );

        hasRevealed[bountyId][msg.sender] = true;
        bounty.submissions.push(
            Submission({submitter: msg.sender, answer: answer})
        );

        emit AnswerRevealed(bountyId, msg.sender);
    }

    function judgeAll(
        uint256 bountyId,
        bytes calldata llmInput
    ) external bountyExists(bountyId) onlyOwner(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(block.timestamp > bounty.revealDeadline, "reveal phase still active");
        require(!bounty.judged, "already judged");
        require(!bounty.finalized, "already finalized");
        require(bounty.submissions.length > 0, "no submissions");

        bytes memory output = _executePrecompile(
            LLM_INFERENCE_PRECOMPILE,
            llmInput
        );

        (
            bool hasError,
            bytes memory completionData,
            ,
            string memory errorMessage,

        ) = abi.decode(output, (bool, bytes, bytes, string, ConvoHistory));

        require(!hasError, errorMessage);

        bounty.judged = true;
        bounty.aiReview = completionData;

        emit AllAnswersJudged(bountyId, completionData);
    }

    function finalizeWinner(
        uint256 bountyId,
        uint256 winnerIndex
    ) external bountyExists(bountyId) onlyOwner(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(bounty.judged, "not judged yet");
        require(!bounty.finalized, "already finalized");

        bounty.finalized = true;
        bounty.winnerIndex = winnerIndex;

        address winner = bounty.submissions[winnerIndex].submitter;
        uint256 reward = bounty.reward;
        bounty.reward = 0;

        (bool ok, ) = payable(winner).call{value: reward}("");
        require(ok, "payment failed");

        emit WinnerFinalized(bountyId, winnerIndex, winner, reward);
    }

    function getBounty(
        uint256 bountyId
    )
        external
        view
        bountyExists(bountyId)
        returns (
            address owner,
            string memory title,
            string memory rubric,
            uint256 reward,
            uint256 deadline,
            uint256 revealDeadline,
            bool judged,
            bool finalized,
            uint256 submissionCount,
            uint256 winnerIndex,
            bytes memory aiReview
        )
    {
        Bounty storage bounty = bounties[bountyId];

        return (
            bounty.owner,
            bounty.title,
            bounty.rubric,
            bounty.reward,
            bounty.deadline,
            bounty.revealDeadline,
            bounty.judged,
            bounty.finalized,
            bounty.submissions.length,
            bounty.winnerIndex,
            bounty.aiReview
        );
    }

    function getSubmission(
        uint256 bountyId,
        uint256 index
    )
        external
        view
        bountyExists(bountyId)
        returns (address submitter, string memory answer)
    {
        Bounty storage bounty = bounties[bountyId];

        require(index < bounty.submissions.length, "invalid index");

        Submission storage submission = bounty.submissions[index];

        return (submission.submitter, submission.answer);
    }
}

