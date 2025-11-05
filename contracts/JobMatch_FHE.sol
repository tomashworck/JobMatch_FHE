pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract JobMatch_FHE is ZamaEthereumConfig {
    
    struct JobApplication {
        string encryptedSkills;       
        euint32 encryptedMatchScore; 
        uint256 positionId;          
        string encryptedCandidateId; 
        address applicant;           
        uint256 timestamp;           
        bool isProcessed;           
        uint32 decryptedScore;      
    }
    
    struct JobPosition {
        string encryptedRequirements; 
        euint32 encryptedThreshold;   
        string positionTitle;        
        address employer;            
        uint256 timestamp;           
        bool isActive;              
        uint32 decryptedThreshold;  
    }
    
    mapping(uint256 => JobPosition) public jobPositions;
    mapping(uint256 => JobApplication) public jobApplications;
    mapping(uint256 => uint256[]) public positionApplications;
    
    uint256[] public positionIds;
    uint256 public nextPositionId = 1;
    uint256 public nextApplicationId = 1;
    
    event JobPositionCreated(uint256 indexed positionId, address indexed employer);
    event JobApplicationSubmitted(uint256 indexed applicationId, uint256 indexed positionId);
    event ApplicationProcessed(uint256 indexed applicationId, uint32 decryptedScore);
    event PositionThresholdSet(uint256 indexed positionId, uint32 decryptedThreshold);

    constructor() ZamaEthereumConfig() {
    }
    
    function createJobPosition(
        string calldata encryptedRequirements,
        externalEuint32 encryptedThreshold,
        bytes calldata thresholdProof,
        string calldata positionTitle
    ) external {
        require(FHE.isInitialized(FHE.fromExternal(encryptedThreshold, thresholdProof)), "Invalid encrypted threshold");
        
        uint256 positionId = nextPositionId++;
        
        jobPositions[positionId] = JobPosition({
            encryptedRequirements: encryptedRequirements,
            encryptedThreshold: FHE.fromExternal(encryptedThreshold, thresholdProof),
            positionTitle: positionTitle,
            employer: msg.sender,
            timestamp: block.timestamp,
            isActive: true,
            decryptedThreshold: 0
        });
        
        FHE.allowThis(jobPositions[positionId].encryptedThreshold);
        FHE.makePubliclyDecryptable(jobPositions[positionId].encryptedThreshold);
        
        positionIds.push(positionId);
        
        emit JobPositionCreated(positionId, msg.sender);
    }
    
    function applyForJob(
        uint256 positionId,
        string calldata encryptedSkills,
        externalEuint32 encryptedMatchScore,
        bytes calldata scoreProof,
        string calldata encryptedCandidateId
    ) external {
        require(jobPositions[positionId].isActive, "Position not active");
        require(FHE.isInitialized(FHE.fromExternal(encryptedMatchScore, scoreProof)), "Invalid encrypted score");
        
        uint256 applicationId = nextApplicationId++;
        
        jobApplications[applicationId] = JobApplication({
            encryptedSkills: encryptedSkills,
            encryptedMatchScore: FHE.fromExternal(encryptedMatchScore, scoreProof),
            positionId: positionId,
            encryptedCandidateId: encryptedCandidateId,
            applicant: msg.sender,
            timestamp: block.timestamp,
            isProcessed: false,
            decryptedScore: 0
        });
        
        FHE.allowThis(jobApplications[applicationId].encryptedMatchScore);
        FHE.makePubliclyDecryptable(jobApplications[applicationId].encryptedMatchScore);
        
        positionApplications[positionId].push(applicationId);
        
        emit JobApplicationSubmitted(applicationId, positionId);
    }
    
    function processApplication(
        uint256 applicationId,
        bytes memory abiEncodedClearScore,
        bytes memory decryptionProof
    ) external {
        require(!jobApplications[applicationId].isProcessed, "Application already processed");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(jobApplications[applicationId].encryptedMatchScore);
        
        FHE.checkSignatures(cts, abiEncodedClearScore, decryptionProof);
        
        uint32 decodedScore = abi.decode(abiEncodedClearScore, (uint32));
        
        jobApplications[applicationId].decryptedScore = decodedScore;
        jobApplications[applicationId].isProcessed = true;
        
        emit ApplicationProcessed(applicationId, decodedScore);
    }
    
    function setDecryptedThreshold(
        uint256 positionId,
        bytes memory abiEncodedClearThreshold,
        bytes memory decryptionProof
    ) external {
        require(jobPositions[positionId].employer == msg.sender, "Only employer can set threshold");
        require(jobPositions[positionId].decryptedThreshold == 0, "Threshold already set");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(jobPositions[positionId].encryptedThreshold);
        
        FHE.checkSignatures(cts, abiEncodedClearThreshold, decryptionProof);
        
        uint32 decodedThreshold = abi.decode(abiEncodedClearThreshold, (uint32));
        
        jobPositions[positionId].decryptedThreshold = decodedThreshold;
        
        emit PositionThresholdSet(positionId, decodedThreshold);
    }
    
    function getJobPosition(uint256 positionId) external view returns (
        string memory encryptedRequirements,
        string memory positionTitle,
        address employer,
        uint256 timestamp,
        bool isActive,
        uint32 decryptedThreshold
    ) {
        JobPosition storage position = jobPositions[positionId];
        return (
            position.encryptedRequirements,
            position.positionTitle,
            position.employer,
            position.timestamp,
            position.isActive,
            position.decryptedThreshold
        );
    }
    
    function getJobApplication(uint256 applicationId) external view returns (
        string memory encryptedSkills,
        uint256 positionId,
        string memory encryptedCandidateId,
        address applicant,
        uint256 timestamp,
        bool isProcessed,
        uint32 decryptedScore
    ) {
        JobApplication storage application = jobApplications[applicationId];
        return (
            application.encryptedSkills,
            application.positionId,
            application.encryptedCandidateId,
            application.applicant,
            application.timestamp,
            application.isProcessed,
            application.decryptedScore
        );
    }
    
    function getPositionApplications(uint256 positionId) external view returns (uint256[] memory) {
        return positionApplications[positionId];
    }
    
    function getAllPositionIds() external view returns (uint256[] memory) {
        return positionIds;
    }
    
    function closeJobPosition(uint256 positionId) external {
        require(jobPositions[positionId].employer == msg.sender, "Only employer can close position");
        jobPositions[positionId].isActive = false;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}

