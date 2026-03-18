import React, { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';

const API = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const DEFAULT_SETTINGS = {
  threshold: 50,
  min_roi: 30,
  min_profit: 2.00,
  overhead: 15,
  price_basis: 'min_selected',
  pb_map: { current: true, avg30: true, avg90: true, avg180: true, avg365: false },
  active_months: [1,2,3,4,5,6,7,8,9,10,11,12],
  order_basis: 'avg',
  order_pct: 50,
};

export default function App() {
  const [page, setPage] = useState('home');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [file, setFile] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const fileRef = useRef();

  const updateSetting = (key, val) => setSettings(s => ({ ...s, [key]: val }));

  const toggleMonth = (idx) => {
    setSettings(s => {
      const active = s.active_months.includes(idx)
        ? s.active_months.filter(m => m !== idx)
        : [...s.active_months, idx];
      return { ...s, active_months: active };
    });
  };

  const togglePbMap = (key) => {
    setSettings(s => ({ ...s, pb_map: { ...s.pb_map, [key]: !s.pb_map[key] } }));
  };

  const handleFile = (f) => {
    if (!f) return;
    setFile(f);
    setResults([]);
    setError('');
  };

  const runAnalysis = async () => {
    if (!file) { setError('Please upload a price sheet first.'); return; }
    setRunning(true); setProgress(10); setError(''); setResults([]);

    const form = new FormData();
    form.append('file', file);
    form.append('settings', JSON.stringify(settings));

    try {
      setProgress(30);
      const res = await fetch(`${API}/analyze`, { method: 'POST', body: form });
      setProgress(80);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Analysis failed');
      }
      const data = await res.json();
      setResults(data.results || []);
      setProgress(100);
      setPage('results');
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const exportExcel = () => {
    const po = results.filter(r => r.decision !== 'Pass' && r.suggested_qty > 0);
    const wb = XLSX.utils.book_new();

    // Full results sheet
    const allRows = results.map(r => ({
      SKU: r.sku, UPC: r.upc, ASIN: r.asin, 'Product': r.title,
      'Invoice Cost': r.cost, 'True Cost': r.true_cost,
      'Current BB': r.price_current, '30d Avg': r.price_avg30,
      '90d Avg': r.price_avg90, '180d Avg': r.price_avg180,
      'Price Used': r.amz_price, 'Ref %': r.referral_pct,
      'Ref $': r.referral_fee, 'P&P Fee': r.pp_fee,
      'Total FBA': r.fba_fee, 'Fee Source': r.fee_source,
      'Net Sale': r.net_sale, 'Net Profit': r.net_profit, 'ROI %': r.roi,
      [`Ever ${settings.threshold}+`]: r.ever_hit ? 'YES' : 'NO',
      'Peak (All)': r.peak_all, 'Peak (Sel)': r.peak_filtered,
      'Avg (Sel)': r.avg_filtered, 'Sug. Qty': r.suggested_qty,
      'Qty Basis': r.qty_basis_str,
      'Target Buy Price': r.target_supplier,
      'Gap': r.price_gap ? `$${r.price_gap.toFixed(2)}` : '—',
      '% Off Needed': r.pct_off,
      'Low Profit Flag': r.low_profit ? '⚠ Below min $' : '✓ OK',
      'Decision': r.decision,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allRows), 'Deal Analysis');

    // Target PO sheet
    const poRows = po.map(r => ({
      'Product Name': r.title, UPC: r.upc, ASIN: r.asin,
      Quantity: r.suggested_qty,
      'Target Buy Price': r.target_supplier,
      '% Off Needed': r.pct_off,
      'Min Profit Flag': r.low_profit ? '⚠ Below min $' : '✓ OK',
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(poRows), 'Target PO');

    XLSX.writeFile(wb, `ottrd_analysis_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const shown = filter === 'all' ? results
    : filter === 'buy' ? results.filter(r => r.decision !== 'Pass')
    : results.filter(r => r.decision === 'Pass');

  const buys = results.filter(r => r.decision !== 'Pass');
  const avgRoi = buys.length ? (buys.reduce((s,r) => s+(r.roi||0),0)/buys.length).toFixed(1) : '—';
  const totalCost = buys.reduce((s,r) => s+(r.cost||0)*(r.suggested_qty||0),0);

  return (
    <div style={styles.app}>
      <style>{css}</style>

      {/* NAV */}
      <nav style={styles.nav}>
        <div style={styles.navInner}>
          <button onClick={() => setPage('home')} style={styles.logo}>
            <span style={styles.logoO}>O</span>ttrd
          </button>
          <div style={styles.navLinks}>
            {results.length > 0 && (
              <button onClick={() => setPage('results')} style={styles.navBtn}>Results</button>
            )}
            <button onClick={() => setPage('analyze')} style={styles.navBtnPrimary}>
              New Analysis
            </button>
          </div>
        </div>
      </nav>

      {/* HOME */}
      {page === 'home' && (
        <div style={styles.hero}>
          <div style={styles.heroInner}>
            <div style={styles.badge}>Amazon Deal Underwriting</div>
            <h1 style={styles.heroTitle}>
              <span style={styles.logoO}>O</span>ttrd
            </h1>
            <p style={styles.heroSub}>
              Upload your supplier linesheet. We pull 12 months of Keepa data,
              calculate true ROI, and generate your purchase order — in minutes.
            </p>
            <div style={styles.heroFeatures}>
              {['Real Keepa sales data','True cost with overhead','Target buy price calculator','Multi-ASIN per UPC','Color-coded Excel export'].map(f => (
                <div key={f} style={styles.feature}>
                  <span style={styles.featureDot} />
                  {f}
                </div>
              ))}
            </div>
            <button onClick={() => setPage('analyze')} style={styles.heroCta}>
              Start Analysis →
            </button>
          </div>
          <div style={styles.heroDecor} />
        </div>
      )}

      {/* ANALYZE */}
      {page === 'analyze' && (
        <div style={styles.content}>
          <h2 style={styles.pageTitle}>New Analysis</h2>

          {error && <div style={styles.errorBox}>{error}</div>}

          {/* Upload */}
          <div style={styles.card}>
            <div style={styles.cardLabel}>Step 1 — Upload linesheet</div>
            <div
              style={{ ...styles.dropzone, ...(file ? styles.dropzoneActive : {}) }}
              onClick={() => fileRef.current.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
            >
              <div style={styles.dropIcon}>📄</div>
              {file ? (
                <div>
                  <div style={styles.fileName}>{file.name}</div>
                  <div style={styles.fileHint}>Click to change</div>
                </div>
              ) : (
                <div>
                  <div style={styles.dropText}>Drop your CSV or Excel file here</div>
                  <div style={styles.fileHint}>or click to browse</div>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls"
              style={{ display:'none' }} onChange={e => handleFile(e.target.files[0])} />
          </div>

          {/* Settings */}
          <div style={styles.card}>
            <div style={styles.cardLabel}>Step 2 — Deal thresholds</div>
            <div style={styles.settingsGrid}>
              {[
                ['Sales threshold (units/mo)', 'threshold', 1, 500, 10, '0'],
                ['Min ROI %', 'min_roi', 0, 200, 5, '0'],
                ['Min profit $ per unit', 'min_profit', 0, 100, 0.5, '0.00'],
                ['Overhead markup %', 'overhead', 0, 100, 0.5, '0.0'],
              ].map(([label, key, min, max, step, fmt]) => (
                <label key={key} style={styles.settingLabel}>
                  {label}
                  <div style={styles.settingRow}>
                    <input type="range" min={min} max={max} step={step}
                      value={settings[key]}
                      onChange={e => updateSetting(key, parseFloat(e.target.value))}
                      style={styles.slider} />
                    <span style={styles.settingVal}>
                      {key === 'min_profit' ? `$${settings[key].toFixed(2)}`
                       : key === 'overhead' || key === 'min_roi' ? `${settings[key]}%`
                       : settings[key]}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Price basis */}
          <div style={styles.card}>
            <div style={styles.cardLabel}>Step 3 — Price basis for ROI</div>
            <div style={styles.radioGroup}>
              {[
                ['min_selected', 'Min of selected (recommended)'],
                ['current', "Today's buy box"],
                ['avg30', '30-day avg'],
                ['avg90', '90-day avg'],
                ['avg180', '180-day avg'],
                ['avg365', '365-day avg'],
              ].map(([val, label]) => (
                <label key={val} style={styles.radioLabel}>
                  <input type="radio" name="pb" value={val}
                    checked={settings.price_basis === val}
                    onChange={() => updateSetting('price_basis', val)} />
                  {label}
                </label>
              ))}
            </div>
            {settings.price_basis === 'min_selected' && (
              <div style={{ marginTop: 12 }}>
                <div style={styles.hint}>Include in minimum:</div>
                <div style={styles.checkGroup}>
                  {Object.entries(settings.pb_map).map(([key, val]) => (
                    <label key={key} style={styles.checkLabel}>
                      <input type="checkbox" checked={val} onChange={() => togglePbMap(key)} />
                      {key === 'current' ? 'Current' : key.replace('avg','')+'-day'}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Month filter */}
          <div style={styles.card}>
            <div style={styles.cardLabel}>Step 4 — Peak sales months</div>
            <div style={styles.monthGrid}>
              {MONTHS.map((m, i) => {
                const active = settings.active_months.includes(i + 1);
                return (
                  <button key={m}
                    style={{ ...styles.monthBtn, ...(active ? styles.monthBtnActive : {}) }}
                    onClick={() => toggleMonth(i + 1)}>
                    {m}
                  </button>
                );
              })}
            </div>
            <div style={styles.monthPresets}>
              <button style={styles.presetBtn} onClick={() => updateSetting('active_months',[1,2,3,4,5,6,7,8,9,10,11,12])}>All</button>
              <button style={styles.presetBtn} onClick={() => updateSetting('active_months',[10,11,12])}>Q4 only</button>
              <button style={styles.presetBtn} onClick={() => {
                const now = new Date();
                const last6 = Array.from({length:6},(_,i)=>{ let m=now.getMonth()+1-i; while(m<=0)m+=12; return m; });
                updateSetting('active_months', last6);
              }}>Last 6 months</button>
            </div>
          </div>

          {/* Order qty */}
          <div style={styles.card}>
            <div style={styles.cardLabel}>Step 5 — Order quantity basis</div>
            <div style={styles.radioGroup}>
              <label style={styles.radioLabel}>
                <input type="radio" name="ob" value="peak"
                  checked={settings.order_basis==='peak'}
                  onChange={() => updateSetting('order_basis','peak')} />
                Peak of selected months
              </label>
              <label style={styles.radioLabel}>
                <input type="radio" name="ob" value="avg"
                  checked={settings.order_basis==='avg'}
                  onChange={() => updateSetting('order_basis','avg')} />
                Average of selected months ×
                <input type="number" min="1" max="200" value={settings.order_pct}
                  onChange={e => updateSetting('order_pct', parseInt(e.target.value)||50)}
                  style={styles.inlineNum} />
                %
              </label>
            </div>
            <div style={styles.monthPresets}>
              {[25,35,50,75,90,100].map(p => (
                <button key={p} style={styles.presetBtn}
                  onClick={() => { updateSetting('order_basis','avg'); updateSetting('order_pct',p); }}>
                  {p}%
                </button>
              ))}
            </div>
          </div>

          {/* Run */}
          <button onClick={runAnalysis} disabled={running || !file} style={styles.runBtn}>
            {running ? `Analyzing… ${progress}%` : '▶  Run Analysis'}
          </button>
          {running && (
            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${progress}%` }} />
            </div>
          )}
        </div>
      )}

      {/* RESULTS */}
      {page === 'results' && results.length > 0 && (
        <div style={styles.content}>
          <div style={styles.resultsHeader}>
            <div>
              <h2 style={styles.pageTitle}>Analysis Results</h2>
              <div style={styles.resultsSubtitle}>{results.length} SKUs analyzed</div>
            </div>
            <button onClick={exportExcel} style={styles.exportBtn}>
              Export Excel ↓
            </button>
          </div>

          {/* Metrics */}
          <div style={styles.metrics}>
            {[
              ['Total SKUs', results.length, ''],
              ['Buy / Review', buys.length, 'green'],
              ['Avg ROI', avgRoi + '%', avgRoi >= 30 ? 'green' : avgRoi >= 15 ? 'amber' : 'red'],
              ['Total PO Cost', '$' + totalCost.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}), ''],
            ].map(([label, val, color]) => (
              <div key={label} style={styles.metricCard}>
                <div style={styles.metricLabel}>{label}</div>
                <div style={{ ...styles.metricVal, color: color === 'green' ? '#0a6640' : color === 'amber' ? '#7a4a00' : color === 'red' ? '#7a1a1a' : 'inherit' }}>
                  {val}
                </div>
              </div>
            ))}
          </div>

          {/* Filter + Table */}
          <div style={styles.tableControls}>
            {[['all','All'],['buy','Buy/Review'],['pass','Pass']].map(([f,label]) => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ ...styles.filterBtn, ...(filter===f ? styles.filterBtnActive : {}) }}>
                {label}
              </button>
            ))}
          </div>

          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {['Product','UPC','Cost','Amz Price','Net Profit','ROI %','Sug. Qty','Decision'].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => {
                  const rowBg = r.low_profit ? '#fdebd0'
                    : r.decision === 'Buy' ? '#e8f5e9'
                    : r.decision === 'Review' ? '#fffde7'
                    : 'transparent';
                  return (
                    <tr key={i} style={{ background: rowBg }}>
                      <td style={{ ...styles.td, maxWidth: 200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={r.title}>{r.title || '—'}</td>
                      <td style={{ ...styles.td, fontFamily:'monospace', fontSize:11 }}>{r.upc}</td>
                      <td style={styles.td}>{r.cost ? `$${r.cost.toFixed(2)}` : '—'}</td>
                      <td style={styles.td}>{r.amz_price ? `$${r.amz_price.toFixed(2)}` : '—'}</td>
                      <td style={{ ...styles.td, color: r.net_profit > 0 ? '#0a6640' : r.net_profit < 0 ? '#7a1a1a' : 'inherit', fontWeight: 600 }}>
                        {r.net_profit != null ? `$${r.net_profit.toFixed(2)}` : '—'}
                      </td>
                      <td style={{ ...styles.td, color: r.roi >= 30 ? '#0a6640' : r.roi >= 15 ? '#7a4a00' : r.roi != null ? '#7a1a1a' : 'inherit', fontWeight: 600 }}>
                        {r.roi != null ? `${r.roi.toFixed(1)}%` : '—'}
                      </td>
                      <td style={{ ...styles.td, textAlign:'center', fontWeight: 600 }}>{r.suggested_qty || '—'}</td>
                      <td style={styles.td}>
                        <span style={{
                          ...styles.badge,
                          background: r.low_profit ? '#fdebd0' : r.decision==='Buy' ? '#e8f5e9' : r.decision==='Review' ? '#fffde7' : '#f5f5f5',
                          color: r.low_profit ? '#7a4a00' : r.decision==='Buy' ? '#0a6640' : r.decision==='Review' ? '#7a4a00' : '#666',
                          border: r.low_profit ? '1px solid #f0c070' : 'none',
                        }}>
                          {r.low_profit ? '⚠ Low $' : r.decision}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  app: { minHeight:'100vh', background:'#0d0d0d', color:'#f0f0f0', fontFamily:"'DM Sans', system-ui, sans-serif" },
  nav: { position:'sticky', top:0, zIndex:100, background:'rgba(13,13,13,0.85)', backdropFilter:'blur(12px)', borderBottom:'1px solid rgba(255,255,255,0.08)' },
  navInner: { maxWidth:1100, margin:'0 auto', padding:'0 24px', height:60, display:'flex', alignItems:'center', justifyContent:'space-between' },
  logo: { background:'none', border:'none', cursor:'pointer', fontSize:22, fontWeight:700, color:'#f0f0f0', letterSpacing:'-0.5px' },
  logoO: { color:'#f0a500' },
  navLinks: { display:'flex', gap:12, alignItems:'center' },
  navBtn: { background:'none', border:'none', cursor:'pointer', color:'rgba(240,240,240,0.7)', fontSize:14, padding:'6px 12px' },
  navBtnPrimary: { background:'#f0a500', border:'none', cursor:'pointer', color:'#0d0d0d', fontSize:14, fontWeight:600, padding:'8px 18px', borderRadius:8 },
  hero: { minHeight:'calc(100vh - 60px)', display:'flex', alignItems:'center', justifyContent:'center', position:'relative', overflow:'hidden', padding:'60px 24px' },
  heroInner: { maxWidth:620, textAlign:'center', position:'relative', zIndex:1 },
  badge: { display:'inline-block', background:'rgba(240,165,0,0.15)', color:'#f0a500', border:'1px solid rgba(240,165,0,0.3)', borderRadius:20, padding:'4px 14px', fontSize:12, fontWeight:600, letterSpacing:'0.05em', marginBottom:24 },
  heroTitle: { fontSize:'clamp(56px,10vw,96px)', fontWeight:800, letterSpacing:'-3px', margin:'0 0 20px', lineHeight:1 },
  heroSub: { fontSize:18, color:'rgba(240,240,240,0.65)', lineHeight:1.7, marginBottom:36 },
  heroFeatures: { display:'flex', flexDirection:'column', gap:8, alignItems:'flex-start', display:'inline-flex', marginBottom:40 },
  feature: { display:'flex', alignItems:'center', gap:10, fontSize:14, color:'rgba(240,240,240,0.75)' },
  featureDot: { width:6, height:6, borderRadius:'50%', background:'#f0a500', flexShrink:0 },
  heroCta: { background:'#f0a500', color:'#0d0d0d', border:'none', cursor:'pointer', fontSize:16, fontWeight:700, padding:'14px 32px', borderRadius:10, letterSpacing:'-0.3px' },
  heroDecor: { position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', width:600, height:600, borderRadius:'50%', background:'radial-gradient(circle, rgba(240,165,0,0.06) 0%, transparent 70%)', pointerEvents:'none' },
  content: { maxWidth:860, margin:'0 auto', padding:'40px 24px 80px' },
  pageTitle: { fontSize:28, fontWeight:700, letterSpacing:'-0.8px', margin:'0 0 24px' },
  card: { background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.08)', borderRadius:14, padding:'20px 24px', marginBottom:16 },
  cardLabel: { fontSize:11, fontWeight:700, color:'#f0a500', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:14 },
  dropzone: { border:'2px dashed rgba(255,255,255,0.15)', borderRadius:10, padding:'36px 24px', textAlign:'center', cursor:'pointer', transition:'all 0.2s' },
  dropzoneActive: { borderColor:'#f0a500', background:'rgba(240,165,0,0.05)' },
  dropIcon: { fontSize:32, marginBottom:8 },
  dropText: { fontSize:15, color:'rgba(240,240,240,0.8)', marginBottom:4 },
  fileName: { fontSize:15, fontWeight:600, color:'#f0a500' },
  fileHint: { fontSize:12, color:'rgba(240,240,240,0.4)', marginTop:4 },
  settingsGrid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 },
  settingLabel: { display:'flex', flexDirection:'column', gap:8, fontSize:13, color:'rgba(240,240,240,0.7)' },
  settingRow: { display:'flex', alignItems:'center', gap:10 },
  slider: { flex:1, accentColor:'#f0a500' },
  settingVal: { fontSize:14, fontWeight:600, color:'#f0f0f0', minWidth:52, textAlign:'right' },
  radioGroup: { display:'flex', flexDirection:'column', gap:10 },
  radioLabel: { display:'flex', alignItems:'center', gap:8, fontSize:14, color:'rgba(240,240,240,0.8)', cursor:'pointer' },
  checkGroup: { display:'flex', gap:16, flexWrap:'wrap', marginTop:8 },
  checkLabel: { display:'flex', alignItems:'center', gap:6, fontSize:13, color:'rgba(240,240,240,0.7)', cursor:'pointer' },
  hint: { fontSize:12, color:'rgba(240,240,240,0.45)', marginBottom:4 },
  monthGrid: { display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:8, marginBottom:12 },
  monthBtn: { padding:'8px 0', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, color:'rgba(240,240,240,0.6)', fontSize:13, cursor:'pointer' },
  monthBtnActive: { background:'rgba(240,165,0,0.2)', borderColor:'#f0a500', color:'#f0a500', fontWeight:600 },
  monthPresets: { display:'flex', gap:8, flexWrap:'wrap' },
  presetBtn: { padding:'5px 12px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:6, color:'rgba(240,240,240,0.7)', fontSize:12, cursor:'pointer' },
  inlineNum: { width:52, padding:'2px 6px', background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:6, color:'#f0f0f0', fontSize:13, margin:'0 4px' },
  runBtn: { width:'100%', padding:'16px', background:'#f0a500', color:'#0d0d0d', border:'none', borderRadius:12, fontSize:16, fontWeight:700, cursor:'pointer', marginTop:8, letterSpacing:'-0.3px' },
  progressBar: { height:4, background:'rgba(255,255,255,0.08)', borderRadius:2, marginTop:12, overflow:'hidden' },
  progressFill: { height:'100%', background:'#f0a500', transition:'width 0.4s' },
  errorBox: { background:'rgba(200,50,50,0.15)', border:'1px solid rgba(200,50,50,0.3)', borderRadius:10, padding:'12px 16px', fontSize:14, color:'#ff8080', marginBottom:16 },
  resultsHeader: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 },
  resultsSubtitle: { fontSize:14, color:'rgba(240,240,240,0.5)', marginTop:4 },
  exportBtn: { background:'#f0a500', color:'#0d0d0d', border:'none', borderRadius:8, padding:'10px 20px', fontSize:14, fontWeight:700, cursor:'pointer' },
  metrics: { display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 },
  metricCard: { background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.08)', borderRadius:10, padding:'16px' },
  metricLabel: { fontSize:12, color:'rgba(240,240,240,0.5)', marginBottom:6 },
  metricVal: { fontSize:24, fontWeight:700, letterSpacing:'-0.5px' },
  tableControls: { display:'flex', gap:8, marginBottom:12 },
  filterBtn: { padding:'6px 16px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, color:'rgba(240,240,240,0.6)', fontSize:13, cursor:'pointer' },
  filterBtnActive: { background:'rgba(240,165,0,0.15)', borderColor:'#f0a500', color:'#f0a500' },
  tableWrap: { overflowX:'auto', borderRadius:12, border:'1px solid rgba(255,255,255,0.08)' },
  table: { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th: { textAlign:'left', padding:'10px 14px', fontSize:11, fontWeight:600, color:'rgba(240,240,240,0.5)', background:'rgba(255,255,255,0.03)', borderBottom:'1px solid rgba(255,255,255,0.08)', whiteSpace:'nowrap' },
  td: { padding:'9px 14px', borderBottom:'1px solid rgba(255,255,255,0.05)' },
  badge: { display:'inline-block', padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600 },
};

const css = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0d0d0d; }
input[type=radio], input[type=checkbox] { accent-color: #f0a500; }
tr:hover td { background: rgba(255,255,255,0.02); }
button:active { transform: scale(0.98); }
`;
