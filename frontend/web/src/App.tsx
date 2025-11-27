import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface JobData {
  id: string;
  title: string;
  encryptedSkill: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingJob, setCreatingJob] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newJobData, setNewJobData] = useState({ title: "", skill: "", description: "" });
  const [selectedJob, setSelectedJob] = useState<JobData | null>(null);
  const [decryptedSkill, setDecryptedSkill] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [stats, setStats] = useState({ total: 0, verified: 0, avgSkill: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const jobsList: JobData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          jobsList.push({
            id: businessId,
            title: businessData.name,
            encryptedSkill: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setJobs(jobsList);
      updateStats(jobsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (jobsList: JobData[]) => {
    const total = jobsList.length;
    const verified = jobsList.filter(j => j.isVerified).length;
    const avgSkill = total > 0 ? jobsList.reduce((sum, j) => sum + j.publicValue1, 0) / total : 0;
    
    setStats({ total, verified, avgSkill });
  };

  const createJob = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingJob(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating job with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const skillValue = parseInt(newJobData.skill) || 0;
      const businessId = `job-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, skillValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newJobData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        skillValue,
        0,
        newJobData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Job created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewJobData({ title: "", skill: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingJob(false); 
    }
  };

  const decryptSkill = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Skill decrypted and verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and ready" 
      });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredJobs = jobs.filter(job => 
    job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    job.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>JobMatch FHE 🔐</h1>
            <p>Privacy-First Blind Recruitment</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">👥</div>
            <h2>Connect to Start Blind Recruitment</h2>
            <p>Join our FHE-based platform where skills matter more than demographics</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to access the system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE encryption will initialize automatically</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start matching based on encrypted skills only</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your recruitment data</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted recruitment system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>JobMatch FHE 🔐</h1>
          <p>Skills-Based Blind Hiring</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">
            Check Status
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Post Job
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-card">
            <h3>Total Jobs</h3>
            <div className="stat-value">{stats.total}</div>
          </div>
          <div className="stat-card">
            <h3>Verified Skills</h3>
            <div className="stat-value">{stats.verified}</div>
          </div>
          <div className="stat-card">
            <h3>Avg Skill Level</h3>
            <div className="stat-value">{stats.avgSkill.toFixed(1)}</div>
          </div>
        </div>

        <div className="search-section">
          <input
            type="text"
            placeholder="Search jobs by title or description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="jobs-grid">
          {filteredJobs.length === 0 ? (
            <div className="no-jobs">
              <p>No job listings found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Post First Job
              </button>
            </div>
          ) : (
            filteredJobs.map((job) => (
              <div key={job.id} className="job-card" onClick={() => setSelectedJob(job)}>
                <div className="job-header">
                  <h3>{job.title}</h3>
                  <span className={`status ${job.isVerified ? 'verified' : 'encrypted'}`}>
                    {job.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                  </span>
                </div>
                <p className="job-desc">{job.description}</p>
                <div className="job-meta">
                  <span>Skill Level: {job.publicValue1}/10</span>
                  <span>Posted: {new Date(job.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="job-creator">
                  Recruiter: {job.creator.substring(0, 6)}...{job.creator.substring(38)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showCreateModal && (
        <CreateJobModal
          onSubmit={createJob}
          onClose={() => setShowCreateModal(false)}
          creating={creatingJob}
          jobData={newJobData}
          setJobData={setNewJobData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedJob && (
        <JobDetailModal
          job={selectedJob}
          onClose={() => {
            setSelectedJob(null);
            setDecryptedSkill(null);
          }}
          decryptedSkill={decryptedSkill}
          setDecryptedSkill={setDecryptedSkill}
          isDecrypting={isDecrypting || fheIsDecrypting}
          decryptSkill={() => decryptSkill(selectedJob.id)}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <p>JobMatch FHE - Eliminating bias through encrypted skill matching</p>
      </footer>
    </div>
  );
};

const CreateJobModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  jobData: any;
  setJobData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, jobData, setJobData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'skill') {
      const intValue = value.replace(/[^\d]/g, '');
      setJobData({ ...jobData, [name]: intValue });
    } else {
      setJobData({ ...jobData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Post New Job</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Skill Encryption</strong>
            <p>Candidate skills will be encrypted for bias-free matching</p>
          </div>
          
          <div className="form-group">
            <label>Job Title *</label>
            <input 
              type="text" 
              name="title" 
              value={jobData.title} 
              onChange={handleChange} 
              placeholder="Enter job title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Required Skill Level (1-10) *</label>
            <input 
              type="number" 
              name="skill" 
              min="1" 
              max="10" 
              value={jobData.skill} 
              onChange={handleChange} 
              placeholder="Enter skill level..." 
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Job Description *</label>
            <textarea 
              name="description" 
              value={jobData.description} 
              onChange={handleChange} 
              placeholder="Enter job description..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !jobData.title || !jobData.skill || !jobData.description}
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Posting..." : "Post Job"}
          </button>
        </div>
      </div>
    </div>
  );
};

const JobDetailModal: React.FC<{
  job: JobData;
  onClose: () => void;
  decryptedSkill: number | null;
  setDecryptedSkill: (value: number | null) => void;
  isDecrypting: boolean;
  decryptSkill: () => Promise<number | null>;
}> = ({ job, onClose, decryptedSkill, setDecryptedSkill, isDecrypting, decryptSkill }) => {
  const handleDecrypt = async () => {
    if (decryptedSkill !== null) {
      setDecryptedSkill(null);
      return;
    }
    
    const decrypted = await decryptSkill();
    if (decrypted !== null) {
      setDecryptedSkill(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Job Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="job-info">
            <div className="info-item">
              <span>Title:</span>
              <strong>{job.title}</strong>
            </div>
            <div className="info-item">
              <span>Recruiter:</span>
              <strong>{job.creator.substring(0, 6)}...{job.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Posted:</span>
              <strong>{new Date(job.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Public Skill Level:</span>
              <strong>{job.publicValue1}/10</strong>
            </div>
          </div>
          
          <div className="description-section">
            <h3>Job Description</h3>
            <p>{job.description}</p>
          </div>
          
          <div className="encryption-section">
            <h3>Encrypted Skill Matching</h3>
            
            <div className="data-row">
              <div className="data-label">Required Skill:</div>
              <div className="data-value">
                {job.isVerified ? 
                  `${job.decryptedValue} (On-chain Verified)` : 
                  decryptedSkill !== null ? 
                  `${decryptedSkill} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(job.isVerified || decryptedSkill !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt}
                disabled={isDecrypting}
              >
                {isDecrypting ? "🔓 Verifying..." :
                 job.isVerified ? "✅ Verified" :
                 decryptedSkill !== null ? "🔄 Re-verify" : "🔓 Verify Skill"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE-Based Blind Recruitment</strong>
                <p>Skills are encrypted on-chain for bias-free matching. Verification ensures candidate skills match requirements without revealing identities.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!job.isVerified && (
            <button 
              onClick={handleDecrypt}
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;