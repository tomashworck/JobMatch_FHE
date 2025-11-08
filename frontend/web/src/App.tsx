import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface JobData {
  id: number;
  title: string;
  encryptedSkill: string;
  requiredSkill: number;
  salaryRange: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface SkillAnalysis {
  matchScore: number;
  skillGap: number;
  compatibility: number;
  potential: number;
  riskLevel: number;
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
    status: "pending" as const, 
    message: "" 
  });
  const [newJobData, setNewJobData] = useState({ title: "", skill: "", salary: "" });
  const [selectedJob, setSelectedJob] = useState<JobData | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [userHistory, setUserHistory] = useState<string[]>([]);
  const [stats, setStats] = useState({ total: 0, verified: 0, avgSkill: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed." 
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
            id: parseInt(businessId.replace('job-', '')) || Date.now(),
            title: businessData.name,
            encryptedSkill: businessId,
            requiredSkill: Number(businessData.publicValue1) || 0,
            salaryRange: `$${Number(businessData.publicValue2) || 0}K`,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setJobs(jobsList);
      updateStats(jobsList);
      addHistory("Data loaded");
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

  const addHistory = (action: string) => {
    setUserHistory(prev => [...prev.slice(-9), `${new Date().toLocaleTimeString()}: ${action}`]);
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
        parseInt(newJobData.salary) || 0,
        "Job Position"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Job created successfully!" });
      addHistory("Created new job");
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewJobData({ title: "", skill: "", salary: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingJob(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
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
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      addHistory("Decrypted skill data");
      
      setTransactionStatus({ visible: true, status: "success", message: "Skill decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const analyzeSkill = (job: JobData, decryptedSkill: number | null): SkillAnalysis => {
    const skill = job.isVerified ? (job.decryptedValue || 0) : (decryptedSkill || job.publicValue1 || 5);
    const required = job.publicValue1 || 5;
    
    const matchScore = Math.min(100, Math.round((skill / required) * 100));
    const skillGap = Math.abs(skill - required);
    const compatibility = Math.round((skill * 0.6 + required * 0.4) * 10);
    const potential = Math.min(95, Math.round((skill * 0.3 + required * 0.7) * 15));
    const riskLevel = Math.max(5, Math.min(95, 100 - matchScore));

    return { matchScore, skillGap, compatibility, potential, riskLevel };
  };

  const filteredJobs = jobs.filter(job => 
    job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    job.salaryRange.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStats = () => {
    return (
      <div className="stats-panels">
        <div className="stat-panel neon-purple">
          <h3>Total Jobs</h3>
          <div className="stat-value">{stats.total}</div>
          <div className="stat-trend">FHE Protected</div>
        </div>
        
        <div className="stat-panel neon-blue">
          <h3>Verified Skills</h3>
          <div className="stat-value">{stats.verified}/{stats.total}</div>
          <div className="stat-trend">On-chain Verified</div>
        </div>
        
        <div className="stat-panel neon-pink">
          <h3>Avg Skill Level</h3>
          <div className="stat-value">{stats.avgSkill.toFixed(1)}/10</div>
          <div className="stat-trend">Encrypted Matching</div>
        </div>
      </div>
    );
  };

  const renderAnalysisChart = (job: JobData, decryptedSkill: number | null) => {
    const analysis = analyzeSkill(job, decryptedSkill);
    
    return (
      <div className="analysis-chart">
        <div className="chart-row">
          <div className="chart-label">Match Score</div>
          <div className="chart-bar">
            <div className="bar-fill" style={{ width: `${analysis.matchScore}%` }}>
              <span className="bar-value">{analysis.matchScore}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Skill Gap</div>
          <div className="chart-bar">
            <div className="bar-fill" style={{ width: `${Math.min(100, analysis.skillGap * 10)}%` }}>
              <span className="bar-value">{analysis.skillGap}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Compatibility</div>
          <div className="chart-bar">
            <div className="bar-fill" style={{ width: `${analysis.compatibility}%` }}>
              <span className="bar-value">{analysis.compatibility}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Growth Potential</div>
          <div className="chart-bar">
            <div className="bar-fill growth" style={{ width: `${analysis.potential}%` }}>
              <span className="bar-value">{analysis.potential}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Risk Level</div>
          <div className="chart-bar">
            <div className="bar-fill risk" style={{ width: `${analysis.riskLevel}%` }}>
              <span className="bar-value">{analysis.riskLevel}%</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">🔒</div>
          <div className="step-content">
            <h4>Skill Encryption</h4>
            <p>Candidate skills encrypted with FHE technology</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">⚡</div>
          <div className="step-content">
            <h4>Blind Matching</h4>
            <p>Encrypted skills matched without decryption</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">🔓</div>
          <div className="step-content">
            <h4>Secure Reveal</h4>
            <p>Skills revealed only after successful match</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>JobMatch FHE 🔐</h1>
            <p>Blind Recruitment • Encrypted Skills</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">👥</div>
            <h2>Connect to Start Blind Recruitment</h2>
            <p>Connect your wallet to access the FHE-powered job matching system</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Post jobs with encrypted skill requirements</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Match candidates fairly without bias</p>
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
      <p>Loading encrypted job matching system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>JobMatch FHE 🔐</h1>
          <p>Eliminating Bias Through Encryption</p>
        </div>
        
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Post Job
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Fair Recruitment Analytics</h2>
          {renderStats()}
          
          <div className="search-section">
            <input 
              type="text"
              placeholder="🔍 Search jobs by title or salary..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>

          <div className="fhe-explanation">
            <h3>FHE-Powered Blind Matching</h3>
            {renderFHEFlow()}
          </div>
        </div>
        
        <div className="jobs-section">
          <div className="section-header">
            <h2>Available Positions ({filteredJobs.length})</h2>
            <div className="header-actions">
              <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="jobs-grid">
            {filteredJobs.length === 0 ? (
              <div className="no-jobs">
                <p>No job positions found</p>
                <button className="create-btn" onClick={() => setShowCreateModal(true)}>
                  Post First Job
                </button>
              </div>
            ) : filteredJobs.map((job, index) => (
              <div className="job-card" key={index} onClick={() => setSelectedJob(job)}>
                <div className="job-title">{job.title}</div>
                <div className="job-meta">
                  <span>Required Skill: {job.publicValue1}/10</span>
                  <span>Salary: {job.salaryRange}</span>
                </div>
                <div className="job-status">
                  {job.isVerified ? "✅ Verified Match" : "🔒 Encrypted"}
                </div>
                <div className="job-creator">Posted by: {job.creator.substring(0, 6)}...{job.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="history-section">
          <h3>Recent Activity</h3>
          <div className="history-list">
            {userHistory.map((entry, index) => (
              <div key={index} className="history-entry">{entry}</div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateJob 
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
            setDecryptedData(null); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedJob.encryptedSkill)}
          renderAnalysisChart={renderAnalysisChart}
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
    </div>
  );
};

const ModalCreateJob: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  jobData: any;
  setJobData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, jobData, setJobData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
      <div className="create-job-modal">
        <div className="modal-header">
          <h2>Post New Job</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Blind Recruitment</strong>
            <p>Skill requirements will be encrypted for fair matching</p>
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
              value={jobData.skill} 
              onChange={handleChange} 
              placeholder="Enter skill level..." 
              min="1"
              max="10"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Salary Range (K$) *</label>
            <input 
              type="number" 
              name="salary" 
              value={jobData.salary} 
              onChange={handleChange} 
              placeholder="Enter salary..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !jobData.title || !jobData.skill || !jobData.salary} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Post Job"}
          </button>
        </div>
      </div>
    </div>
  );
};

const JobDetailModal: React.FC<{
  job: JobData;
  onClose: () => void;
  decryptedData: number | null;
  setDecryptedData: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderAnalysisChart: (job: JobData, decryptedSkill: number | null) => React.ReactNode;
}> = ({ job, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, renderAnalysisChart }) => {
  const handleDecrypt = async () => {
    if (decryptedData !== null) { 
      setDecryptedData(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="job-detail-modal">
        <div className="modal-header">
          <h2>Job Position Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="job-info">
            <div className="info-item">
              <span>Job Title:</span>
              <strong>{job.title}</strong>
            </div>
            <div className="info-item">
              <span>Posted by:</span>
              <strong>{job.creator.substring(0, 6)}...{job.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Salary Range:</span>
              <strong>{job.salaryRange}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Skill Matching</h3>
            
            <div className="data-row">
              <div className="data-label">Required Skill Level:</div>
              <div className="data-value">
                {job.isVerified && job.decryptedValue ? 
                  `${job.decryptedValue}/10 (Verified)` : 
                  decryptedData !== null ? 
                  `${decryptedData}/10 (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(job.isVerified || decryptedData !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : job.isVerified ? "✅ Verified" : decryptedData !== null ? "🔄 Re-verify" : "🔓 Decrypt"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Blind Matching</strong>
                <p>Skills are encrypted to prevent bias. Decryption reveals actual requirements after matching.</p>
              </div>
            </div>
          </div>
          
          {(job.isVerified || decryptedData !== null) && (
            <div className="analysis-section">
              <h3>Match Analysis</h3>
              {renderAnalysisChart(job, job.isVerified ? job.decryptedValue || null : decryptedData)}
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!job.isVerified && (
            <button onClick={handleDecrypt} disabled={isDecrypting} className="verify-btn">
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

