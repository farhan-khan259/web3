import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import UnmintedScanner from './components/UnmintedScanner';
import { 
  Wallet, Layers, TrendingUp, Coins, Activity, 
  CheckCircle2, RefreshCw, Upload, Shield, 
  Lock, Unlock, Zap, Download, AlertCircle, Info
} from 'lucide-react';
import { EthereumProvider } from '@walletconnect/ethereum-provider';
import './index.css';

const VAULT_ABI = [
  "function totalStaked() view returns (uint256)",
  "function getPendingRewards() view returns (uint256)",
  "function rewardRatePerHour() view returns (uint256)",
  "function lastClaimTimestamp() view returns (uint256)",
  "function claimRewards() external",
  "function batchStake(uint256[] calldata tokenIds) external",
  "function batchStakeUnminted(uint256[] calldata tokenIds) external",
  "function batchUnstake(uint256[] calldata tokenIds) external",
  "function setRewardRate(uint256 newRate) external",
  "function pause() external",
  "function unpause() external",
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "event Staked(uint256[] tokenIds, uint256 timestamp)",
  "event Unstaked(uint256[] tokenIds, uint256 timestamp)"
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)"
];

function App() {
  const [account, setAccount] = useState("");
  const vaultAddress = import.meta.env.VITE_VAULT_ADDRESS || "";
  const pytAddress = import.meta.env.VITE_PYT_ADDRESS || "";
  const rpcUrl = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";
  const chainIdInt = parseInt(import.meta.env.VITE_CHAIN_ID || "31337");
  const chainIdHex = "0x" + chainIdInt.toString(16);
  const networkName = import.meta.env.VITE_NETWORK_NAME || "Anvil Localhost";
  
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [stats, setStats] = useState({
    staked: "0",
    pending: "0.0",
    vaultReserve: "0.0",
    userBalance: "0.0",
    rewardRate: "0.0",
    isPaused: false,
    stakedIds: []
  });
  
  const [isClaiming, setIsClaiming] = useState(false);
  const [isStaking, setIsStaking] = useState(false);
  const [stakeIds, setStakeIds] = useState("");
  const [isUnstaking, setIsUnstaking] = useState(false);
  const [unstakeIds, setUnstakeIds] = useState("");
  const [isSettingRate, setIsSettingRate] = useState(false);
  const [newRate, setNewRate] = useState("");
  const [isPausing, setIsPausing] = useState(false);
  const [vaultOwner, setVaultOwner] = useState("");
  const [error, setError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [batchStatus, setBatchStatus] = useState({ current: 0, total: 0, active: false });

  const handleAccountsChanged = useCallback(async (accounts) => {
    if (accounts.length > 0) {
      setAccount(accounts[0]);
      if (provider) {
        try {
          const newSigner = await provider.getSigner();
          setSigner(newSigner);
        } catch (e) {
          console.error("Failed to update signer", e);
        }
      }
    } else {
      setAccount("");
      setSigner(null);
      setProvider(null);
    }
  }, [provider]);

  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', handleAccountsChanged);
    }
    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      }
    }
  }, [handleAccountsChanged]);

  const connectWallet = async () => {
    if (!window.ethereum) {
      setError("Please install MetaMask!");
      return;
    }
    try {
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      setProvider(browserProvider);

      const accounts = await browserProvider.send("eth_requestAccounts", []);
      setAccount(accounts[0]);

      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex }],
        });
      } catch (switchError) {
        if (switchError.code === 4902) {
          try {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: chainIdHex,
                  chainName: networkName,
                  rpcUrls: [rpcUrl],
                  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
                },
              ],
            });
          } catch (addError) {
            console.error("Failed to add local network", addError);
          }
        }
      }

      const activeSigner = await browserProvider.getSigner();
      setSigner(activeSigner);
      setError("");
    } catch (err) {
      setError("Failed to connect wallet. Please try again.");
    }
  };

  const connectWalletConnect = async () => {
    try {
      setIsConnecting(true);
      setError("");
      
      // Initialize the WalletConnect Provider using an open public project ID config
      const wcProvider = await EthereumProvider.init({
        projectId: "8470a6c6e114faeb250269f8ad32b6ad", // Required for WC v2
        showQrModal: true, // Pops open the standard QR Modal for Ballet / Trust Wallet
        chains: [parseInt(chainIdInt)],
        methods: ["eth_sendTransaction", "personal_sign"],
        events: ["chainChanged", "accountsChanged"],
      });

      // Attempt to establish a session, pushing the QR code to screen natively
      await wcProvider.connect();
      
      const browserProvider = new ethers.BrowserProvider(wcProvider);
      setProvider(browserProvider);
      
      const accounts = await browserProvider.send("eth_requestAccounts", []);
      setAccount(accounts[0]);
      
      const activeSigner = await browserProvider.getSigner();
      setSigner(activeSigner);
      setError("");
    } catch (err) {
      console.error(err);
      setError("WalletConnect Failed or Cancelled");
    } finally {
      setIsConnecting(false);
    }
  };

  const fetchStats = async () => {
    if (!ethers.isAddress(vaultAddress) || !ethers.isAddress(pytAddress)) return;
    setIsRefreshing(true);
    try {
      const localProvider = new ethers.JsonRpcProvider(rpcUrl);
      const vault = new ethers.Contract(vaultAddress, VAULT_ABI, localProvider);
      const pyt = new ethers.Contract(pytAddress, ERC20_ABI, localProvider);

      if (rpcUrl.includes('127.0.0.1') || rpcUrl.includes('localhost')) {
        try { await localProvider.send("evm_mine", []); } catch (e) { /* silent */ }
      }

      const [staked, pending, vaultBal, ownerAddr, rateWei, pausedStatus] = await Promise.all([
        vault.totalStaked(),
        vault.getPendingRewards(),
        pyt.balanceOf(vaultAddress),
        vault.owner(),
        vault.rewardRatePerHour(),
        vault.paused()
      ]);

      setVaultOwner(ownerAddr);

      let userBal = 0n;
      if (account) {
        userBal = await pyt.balanceOf(account);
      }

      const stakedLogs = await vault.queryFilter(vault.filters.Staked(), -20000);
      const unstakedLogs = await vault.queryFilter(vault.filters.Unstaked(), -20000);

      const activeIds = new Set();
      stakedLogs.forEach(log => {
        if (log.args && log.args[0]) {
          log.args[0].forEach(id => activeIds.add(id.toString()));
        }
      });
      unstakedLogs.forEach(log => {
        if (log.args && log.args[0]) {
          log.args[0].forEach(id => activeIds.delete(id.toString()));
        }
      });
      const currentStakedIds = Array.from(activeIds).sort((a, b) => Number(a) - Number(b));

      setStats({
        staked: staked.toString(),
        pending: ethers.formatEther(pending),
        vaultReserve: ethers.formatEther(vaultBal),
        userBalance: ethers.formatEther(userBal),
        rewardRate: ethers.formatEther(rateWei),
        isPaused: pausedStatus,
        stakedIds: currentStakedIds
      });
      setError("");
    } catch (err) {
      console.error("fetchStats Error:", err);
      setError(`Node Connection Error: Make sure your RPC is reachable.`);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (vaultAddress && pytAddress) {
      fetchStats();
    }
  }, [account, vaultAddress, pytAddress]);

  const handleClaim = async () => {
    if (!signer || !vaultAddress) return;
    setIsClaiming(true);
    setError("");
    try {
      const vault = new ethers.Contract(vaultAddress, VAULT_ABI, signer);
      const tx = await vault.claimRewards();
      await tx.wait();
      await fetchStats();
    } catch (err) {
      setError("Claim failed. Check console for details.");
    }
    setIsClaiming(false);
  };

  const handleAction = async (type) => {
    const idsString = type === 'stake' ? stakeIds : unstakeIds;
    if (!signer || !vaultAddress || !idsString) return;
    
    const setLoadedIds = type === 'stake' ? setStakeIds : setUnstakeIds;
    const setLoading = type === 'stake' ? setIsStaking : setIsUnstaking;
    
    setLoading(true);
    setError("");
    setBatchStatus({ current: 0, total: 0, active: true });
    
    try {
      const ids = idsString.split(',').filter(id => id.trim() !== '').map(id => BigInt(id.trim()));
      if (ids.length === 0) throw new Error("No valid IDs provided");

      const vault = new ethers.Contract(vaultAddress, VAULT_ABI, signer);
      const CHUNK_SIZE = type === 'stake' ? 200 : 100;
      const totalBatches = Math.ceil(ids.length / CHUNK_SIZE);

      setBatchStatus({ current: 0, total: totalBatches, active: true });

      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        const batchNum = Math.floor(i / CHUNK_SIZE) + 1;
        setBatchStatus(prev => ({ ...prev, current: batchNum }));

        const tx = type === 'stake' ? await vault.batchStake(chunk) : await vault.batchUnstake(chunk);
        await tx.wait();
      }

      setLoadedIds("");
      await fetchStats();
    } catch (err) {
      console.error(err);
      setError(`Action failed: ${err.message}`);
    }
    setLoading(false);
    setBatchStatus({ current: 0, total: 0, active: false });
  };

  const handleFileUpload = (e, target) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target.result;
      const ids = content.match(/\d+/g);
      if (ids) {
        if (target === 'stake') {
          setStakeIds(ids.join(', '));
        } else {
          setUnstakeIds(ids.join(', '));
        }
      } else {
        setError("Invalid file format. No numeric IDs found.");
      }
    };
    reader.readAsText(file);
  };

  const handleSetRate = async () => {
    if (!signer || !vaultAddress || !newRate) return;
    setIsSettingRate(true);
    setError("");
    try {
      const vault = new ethers.Contract(vaultAddress, VAULT_ABI, signer);
      const rateWei = ethers.parseEther(newRate);
      const tx = await vault.setRewardRate(rateWei);
      await tx.wait();
      setNewRate("");
      await fetchStats();
    } catch (err) {
      setError("Setting rate failed. Authorization error.");
    }
    setIsSettingRate(false);
  };

  const togglePause = async (pauseState) => {
    if (!signer || !vaultAddress) return;
    setIsPausing(true);
    setError("");
    try {
      const vault = new ethers.Contract(vaultAddress, VAULT_ABI, signer);
      const tx = await pauseState ? vault.pause() : vault.unpause();
      await tx.wait();
      await fetchStats();
    } catch (err) {
      setError("Guard action failed.");
    }
    setIsPausing(false);
  };

  const isOwner = vaultOwner && account && account.toLowerCase() === vaultOwner.toLowerCase();

  return (
    <div className="container">
      <header className="header glass">
        <div className="logo">
          <Activity size={32} />
          <span>GPM <i style={{ fontWeight: 300, fontSize: '0.8em', opacity: 0.7 }}>Protocol</i></span>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {account && (
            <div className="badge badge-success" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'currentColor' }} />
              Live Network
            </div>
          )}
          
          {account ? (
            <div className="btn btn-outline" style={{ cursor: 'default', borderRadius: '50px', background: 'rgba(255,255,255,0.05)' }}>
              <CheckCircle2 size={18} />
              {account.slice(0, 6)}...{account.slice(-4)}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-outline" onClick={connectWallet}>
                <Wallet size={18} /> Browser
              </button>
              <button 
                className="btn" 
                style={{ backgroundColor: '#3b82f6', color: '#fff', border: 'none' }} 
                onClick={connectWalletConnect} 
                disabled={isConnecting}
              >
                <Wallet size={18} color="#fff" /> {isConnecting ? 'Waiting...' : 'WalletConnect'}
              </button>
            </div>
          )}
        </div>
      </header>

      {error && (
        <div className="error-box">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {account ? (
        <>
          {(!vaultAddress || !pytAddress) && (
            <div className="error-box" style={{ background: 'rgba(234, 179, 8, 0.1)', color: '#eab308', borderColor: 'rgba(234,179,8,0.2)' }}>
              <Info size={20} />
              Environment Mismatch: Smart contracts not detected on current network.
            </div>
          )}

          <div className="section-header">
            <div>
              <h2 style={{ fontSize: '2rem', fontWeight: 700 }}>Gorilla In Pink Mask</h2>
              <p style={{ color: 'var(--text-secondary)' }}>Real-time treasury distribution and yield projections.</p>
            </div>
            <button
              className="btn btn-ghost"
              onClick={fetchStats}
              disabled={isRefreshing}
              style={{ borderRadius: '12px' }}
            >
              <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
              {isRefreshing ? 'Synchronizing...' : 'Refresh Data'}
            </button>
          </div>

          <div className="grid">
            <div className="card glass">
              <div className="card-title"><Layers size={18} color="var(--accent-primary)" /> Total Staked</div>
              <div className="card-value">{stats.staked} <span>ASSETS</span></div>
            </div>
            <div className="card glass">
              <div className="card-title"><TrendingUp size={18} color="#10b981" /> Accrued Yield</div>
              <div className="card-value">{parseFloat(stats.pending).toFixed(4)} <span>GPM</span></div>
            </div>
            <div className="card glass">
              <div className="card-title"><Shield size={18} color="var(--accent-secondary)" /> Vault Reserve</div>
              <div className="card-value">{parseFloat(stats.vaultReserve).toLocaleString(undefined, { maximumFractionDigits: 0 })} <span>GPM</span></div>
            </div>
            <div className="card glass">
              <div className="card-title"><Coins size={18} color="#f59e0b" /> Wallet Balance</div>
              <div className="card-value">{parseFloat(stats.userBalance).toLocaleString(undefined, { maximumFractionDigits: 2 })} <span>GPM</span></div>
            </div>
          </div>

          <div className="admin-grid">
            {/* Primary Action Panel */}
            <div className="claim-section glass-heavy">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
                <div>
                  <h3 style={{ margin: 0 }}>Treasury Claim</h3>
                  <p style={{ margin: 0, opacity: 0.7 }}>Withdraw accumulated yield tokens to your wallet.</p>
                </div>
                <Zap size={32} color="#fbbf24" style={{ filter: 'drop-shadow(0 0 10px rgba(251,191,36,0.4))' }} />
              </div>
              
              <div className="glass" style={{ padding: '2rem', textAlign: 'center', background: 'rgba(0,0,0,0.2)', marginBottom: '1.5rem' }}>
                <span style={{ fontSize: '1rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Available for extraction</span>
                <div style={{ fontSize: '3rem', fontWeight: 800, margin: '0.5rem 0' }}>{parseFloat(stats.pending).toFixed(6)}</div>
                <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>GPM TOKENS</span>
              </div>

              <button
                className="btn"
                style={{ width: '100%', justifyContent: 'center', padding: '1.25rem', fontSize: '1.1rem' }}
                onClick={handleClaim}
                disabled={isClaiming || parseFloat(stats.pending) === 0 || !vaultAddress}
              >
                {isClaiming ? <RefreshCw className="animate-spin" size={20} /> : 'Execute Claim Extraction'}
              </button>
            </div>

            {/* Staking Controls */}
            <div className="claim-section glass-heavy" style={{ display: 'flex', flexDirection: 'column' }}>
              <h3>Inventory Management</h3>
              <p>Stake or unstake NFTs from the centralized vault.</p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', flex: 1 }}>
                {/* Stake Column */}
                <div className="glass" style={{ padding: '1.5rem', background: 'rgba(0,0,0,0.1)' }}>
                  <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Lock size={16} color="var(--accent-primary)" /> Stake
                  </h4>
                  <div className="input-group" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                    <input
                      type="text"
                      placeholder="ID, ID..."
                      className="form-input"
                      style={{ marginBottom: 0 }}
                      value={stakeIds}
                      onChange={(e) => setStakeIds(e.target.value)}
                    />
                    <label className="btn btn-outline" style={{ padding: '0.75rem', cursor: 'pointer' }}>
                      <Upload size={18} />
                      <input type="file" accept=".txt" onChange={(e) => handleFileUpload(e, 'stake')} style={{ display: 'none' }} />
                    </label>
                  </div>
                  <button
                    className="btn btn-outline"
                    style={{ width: '100%', justifyContent: 'center' }}
                    onClick={() => handleAction('stake')}
                    disabled={isStaking || !stakeIds}
                  >
                    {isStaking ? `Batch ${batchStatus.current}` : 'Confirm Stake'}
                  </button>
                </div>

                {/* Unstake Column */}
                <div className="glass" style={{ padding: '1.5rem', background: 'rgba(0,0,0,0.1)' }}>
                  <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Unlock size={16} color="#ef4444" /> Unstake
                  </h4>
                  <div className="input-group" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                    <input
                      type="text"
                      placeholder="ID, ID..."
                      className="form-input"
                      style={{ marginBottom: 0 }}
                      value={unstakeIds}
                      onChange={(e) => setUnstakeIds(e.target.value)}
                    />
                    <label className="btn btn-outline" style={{ padding: '0.75rem', cursor: 'pointer' }}>
                      <Upload size={18} />
                      <input type="file" accept=".txt" onChange={(e) => handleFileUpload(e, 'unstake')} style={{ display: 'none' }} />
                    </label>
                  </div>
                  <button
                    className="btn btn-outline"
                    style={{ width: '100%', justifyContent: 'center', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }}
                    onClick={() => handleAction('unstake')}
                    disabled={isUnstaking || !unstakeIds}
                  >
                    {isUnstaking ? `Batch ${batchStatus.current}` : 'Confirm Unstake'}
                  </button>
                </div>
              </div>

              {stats.stakedIds.length > 0 && (
                <button
                  className="btn btn-ghost"
                  style={{ marginTop: '1rem', gap: '0.5rem', alignSelf: 'center', fontSize: '0.85rem' }}
                  onClick={() => {
                    const blob = new Blob([stats.stakedIds.join('\n')], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a'); link.href = url;
                    link.download = `inventory_manifest.txt`; link.click();
                  }}
                >
                  <Download size={14} /> Download Staked Manifest ({stats.stakedIds.length})
                </button>
              )}
            </div>

            {/* Active Scanner Sub-panel */}
            <div style={{ gridColumn: '1 / -1' }}>
              <UnmintedScanner />
            </div>

            {/* Admin Governance Sub-panel */}
            <div className="claim-section glass-heavy" style={{ gridColumn: '1 / -1', opacity: isOwner ? 1 : 0.6 }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                 <Shield size={28} color="var(--accent-primary)" />
                 <h3>Protocol Governance</h3>
                 {!isOwner && <div className="badge badge-danger">View Only Mode</div>}
               </div>

               <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '3rem' }}>
                 <div>
                    <span className="card-title" style={{ marginBottom: '1rem' }}>Reward Calibration</span>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                      <input
                        type="text"
                        placeholder="New rate (GPM/hr)"
                        className="form-input"
                        style={{ flex: 1 }}
                        value={newRate}
                        onChange={(e) => setNewRate(e.target.value)}
                        disabled={!isOwner}
                      />
                      <button className="btn" onClick={handleSetRate} disabled={!isOwner || isSettingRate || !newRate}>
                         {isSettingRate ? <RefreshCw className="animate-spin" size={18} /> : 'Update Rate'}
                      </button>
                    </div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>Current Global Rate: {stats.rewardRate} GPM/hr per staked NFT</p>
                 </div>

                 <div>
                    <span className="card-title" style={{ marginBottom: '1rem' }}>Protocol Guardianship</span>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                      <button 
                        className={`btn ${stats.isPaused ? 'badge-danger' : 'btn-outline'}`} 
                        style={{ flex: 1, borderColor: '#ef4444', color: '#ef4444' }}
                        onClick={() => togglePause(true)}
                        disabled={!isOwner || isPausing || stats.isPaused}
                      >
                         <Lock size={18} /> Pause Protocol
                      </button>
                      <button 
                        className={`btn ${!stats.isPaused ? 'badge-success' : 'btn-outline'}`}
                        style={{ flex: 1, borderColor: '#10b981', color: '#10b981' }}
                        onClick={() => togglePause(false)}
                        disabled={!isOwner || isPausing || !stats.isPaused}
                      >
                         <Unlock size={18} /> Unpause Protocol
                      </button>
                    </div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>Status: {stats.isPaused ? 'Operations Suspended' : 'Operations Normal'}</p>
                 </div>
               </div>
            </div>
          </div>
        </>
      ) : (
        <div style={{ 
          textAlign: 'center', padding: '10rem 2rem', 
          display: 'flex', flexDirection: 'column', alignItems: 'center' 
        }}>
          <div style={{ 
            position: 'relative', width: 120, height: 120, 
            background: 'rgba(0,242,255,0.05)', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: '3rem', border: '1px solid rgba(0,242,255,0.2)'
          }}>
            <Shield size={64} style={{ color: 'var(--accent-primary)', filter: 'drop-shadow(0 0 15px rgba(0,242,255,0.4))' }} />
            <div className="animate-spin" style={{ 
              position: 'absolute', inset: -10, border: '1px dashed var(--accent-primary)', 
              borderRadius: '50%', opacity: 0.3 
            }} />
          </div>
          <h1 style={{ fontSize: '3.5rem', fontWeight: 800, marginBottom: '1rem' }}>Quantum Yield Access</h1>
          <p style={{ fontSize: '1.25rem', color: 'var(--text-secondary)', maxWidth: 600, margin: '0 auto 3rem' }}>
            Initialize your terminal to monitor cryptographic vault distributions and manage high-frequency yield protocols.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <button className="btn btn-outline" style={{ padding: '1.25rem 3rem', borderRadius: '100px', fontSize: '1.1rem' }} onClick={connectWallet}>
              Browser Wallet
            </button>
            <button className="btn" style={{ padding: '1.25rem 3rem', borderRadius: '100px', fontSize: '1.1rem', backgroundColor: '#3b82f6', color: '#fff', border: 'none' }} onClick={connectWalletConnect} disabled={isConnecting}>
               {isConnecting ? 'Opening Portal...' : 'WalletConnect / Ballet App'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
