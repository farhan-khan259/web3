import React, { useState } from 'react';
import { ethers } from 'ethers';
import { Search, Loader2, CheckCircle2, AlertCircle, Download, Database, FileSearch, RefreshCw } from 'lucide-react';

const NFT_ADDRESS = "0x0c06d6A17eb208A9BC7Bd698Eb6f22379209e3A4";
const MAINNET_RPC = "https://mainnet.infura.io/v3/2aa96ca084c245dab3db38256f7e9c27";

const NFT_ABI = [
  "event Mint(uint256 indexed tokenId)",
  "function MAX_SUPPLY() view returns (uint256)"
];

const UnmintedScanner = () => {
  const [unmintedIds, setUnmintedIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");

  const downloadIds = (ids = unmintedIds) => {
    if (ids.length === 0) return;
    const content = ids.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `unminted_tokens_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const scanForUnminted = async () => {
    setLoading(true);
    setError("");
    setProgress("Connecting to Ethereum Mainnet...");

    try {
      const provider = new ethers.JsonRpcProvider(MAINNET_RPC);
      const nftContract = new ethers.Contract(NFT_ADDRESS, NFT_ABI, provider);

      setProgress("Fetching mint history (this may take a moment)...");

      const filter = nftContract.filters.Mint();
      const logs = await nftContract.queryFilter(filter);

      const mintedSet = new Set();
      logs.forEach(log => {
        if (log.args && log.args.tokenId) {
          mintedSet.add(log.args.tokenId.toString());
        }
      });

      const available = [];
      for (let i = 1; i <= 10000; i++) {
        if (!mintedSet.has(i.toString())) {
          available.push(i);
        }
      }

      setUnmintedIds(available);
      setProgress(`Found ${available.length} unminted IDs.`);
      downloadIds(available);
      
    } catch (err) {
      console.error(err);
      setError("Failed to scan blockchain: " + (err.reason || err.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-heavy" style={{ padding: '2.5rem', marginTop: '2.5rem', border: '1px solid var(--border-accent)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2.5rem', gap: '2rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{ 
            width: '56px', height: '56px', borderRadius: '16px',
            background: 'linear-gradient(135deg, rgba(0,242,255,0.1), rgba(112,0,255,0.1))', 
            display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-accent)',
            boxShadow: 'inset 0 0 15px rgba(0,242,255,0.1)'
          }}>
            <Database size={28} color="var(--accent-primary)" />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', color: '#fff' }}>Stock Inventory Oracle</h3>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Identifying unminted cryptographic assets on Ethereum L1</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1rem' }}>
          {unmintedIds.length > 0 && !loading && (
            <button
               className="btn btn-outline"
               onClick={() => downloadIds()}
               style={{ width: '48px', height: '48px', padding: 0, justifyContent: 'center', borderRadius: '12px' }}
               title="Re-download Data"
            >
              <Download size={20} />
            </button>
          )}
          <button
            className="btn"
            onClick={scanForUnminted}
            disabled={loading}
            style={{ minWidth: '200px', height: '48px', justifyContent: 'center', borderRadius: '12px', fontSize: '1rem' }}
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : <FileSearch size={20} />}
            {loading ? 'Scanning L1...' : 'Initialize Global Scan'}
          </button>
        </div>
      </div>

      {error && (
        <div className="error-box" style={{ margin: '0 0 2rem' }}>
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      <div className="glass" style={{ 
        padding: '4rem 2rem', textAlign: 'center', 
        background: 'rgba(0,0,0,0.3)', 
        border: '1px dashed rgba(255,255,255,0.05)',
        borderRadius: '24px',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', position: 'relative', zIndex: 2 }}>
            <div style={{ position: 'relative' }}>
               <RefreshCw size={64} className="animate-spin" color="var(--accent-primary)" style={{ filter: 'drop-shadow(0 0 10px var(--accent-primary-glow))' }} />
               <div style={{ 
                 position: 'absolute', inset: -15, borderRadius: '50%', 
                 border: '2px solid var(--accent-primary)', opacity: 0.15,
                 animation: 'pulse 2s infinite'
               }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontWeight: 700, color: 'var(--accent-primary)', fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Protocol Active</p>
              <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>{progress}</p>
            </div>
          </div>
        ) : unmintedIds.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', position: 'relative', zIndex: 2 }}>
             <div style={{ 
               width: '80px', height: '80px', borderRadius: '50%', 
               background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)',
               display: 'flex', alignItems: 'center', justifyContent: 'center'
             }}>
               <CheckCircle2 size={40} color="var(--accent-success)" />
             </div>
             <div>
                <h4 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem', color: '#fff' }}>Sync Completed</h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>Identified <strong>{unmintedIds.length}</strong> available assets for downstream processing.</p>
             </div>
             <button className="btn btn-ghost" style={{ fontSize: '0.9rem', color: 'var(--accent-primary)' }} onClick={() => downloadIds()}>
                <Download size={16} /> Re-generate local manifest
             </button>
          </div>
        ) : (
          <div style={{ opacity: 0.4, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
              <FileSearch size={80} style={{ color: 'var(--text-dim)' }} />
              <Search size={24} style={{ position: 'absolute', bottom: 5, right: 5, color: 'var(--accent-primary)' }} />
            </div>
            <p style={{ fontSize: '1.1rem', fontWeight: 500 }}>Global Index Offline</p>
            <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>Initialize scan to map available EWB registry IDs</p>
          </div>
        )}
        
        {/* Background Decorative Element */}
        <div style={{ 
          position: 'absolute', top: '50%', left: '50%', 
          width: '100%', height: '100%', 
          background: 'radial-gradient(circle at center, rgba(0,242,255,0.03) 0%, transparent 70%)',
          transform: 'translate(-50%, -50%)', pointerEvents: 'none'
        }} />
      </div>

      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); opacity: 0.1; }
          50% { transform: scale(1.3); opacity: 0.3; }
          100% { transform: scale(1); opacity: 0.1; }
        }
      `}</style>
    </div>
  );
};

export default UnmintedScanner;
