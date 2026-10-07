import { useEffect, useState } from 'react';
import Sentinel from '../frontend/src/components/Sentinel';
import type { SentinelState } from '../frontend/src/components/Sentinel';
import { getAuditEvents, type BackendAuditEvent } from '../frontend/src/api/audit';
import { datasetToClaimRows, getIngestedClaims, type ClaimRow } from '../frontend/src/api/claims';

interface DashboardProps {
  onNavigate: (page: string, claimId?: string) => void;
}

// Highly stylized mock claim rows with cardiorespiratory diagnosis codes for the interactive filters
const MOCK_CARDIAC_CLAIMS: ClaimRow[] = [
  {
    id: 'CLM-10482',
    provider: 'Meridian Heart Group',
    member: 'Robert Carter',
    dos: 'Sep 15, 2026',
    findings: 4,
    status: 'review',
    rule: 'R012 · Cardiovascular Billing Check',
    amount: '$2,840.00',
    sentinel: 'review' as SentinelState,
  },
  {
    id: 'CLM-10477',
    provider: 'Metro Health Partners',
    member: 'Michael Foster',
    dos: 'Sep 12, 2026',
    findings: 3,
    status: 'review',
    rule: 'R011 · Coronary Care Window',
    amount: '$4,150.00',
    sentinel: 'review' as SentinelState,
  }
];

const MOCK_PULMONARY_CLAIMS: ClaimRow[] = [
  {
    id: 'CLM-10479',
    provider: 'Northside Clinic',
    member: 'Emily Watson',
    dos: 'Sep 13, 2026',
    findings: 1,
    status: 'uncertain',
    rule: 'R008 · Pulmonary Auth Check',
    amount: '$1,210.00',
    sentinel: 'uncertain' as SentinelState,
  }
];

const MOCK_OTHER_CLAIMS: ClaimRow[] = [
  {
    id: 'CLM-10476',
    provider: 'Riverside Medical Center',
    member: 'Sarah Jenkins',
    dos: 'Sep 11, 2026',
    findings: 1,
    status: 'fail',
    rule: 'R005 · Surgical Modifier Error',
    amount: '$950.00',
    sentinel: 'fail' as SentinelState,
  },
  {
    id: 'CLM-10474',
    provider: 'Summit Care Associates',
    member: 'David Miller',
    dos: 'Sep 10, 2026',
    findings: 2,
    status: 'review',
    rule: 'R002 · Duplicate Line Entry',
    amount: '$1,880.00',
    sentinel: 'review' as SentinelState,
  }
];

export default function ClaimGuardDashboardUpgrade({ onNavigate }: DashboardProps) {
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [activity, setActivity] = useState<BackendAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // INTERACTIVE STATES: Organ highlight / AI context filtering
  const [activeOrgan, setActiveOrgan] = useState<'all' | 'heart' | 'lungs'>('all');
  const [showAiHelper, setShowAiHelper] = useState(false);
  const [aiSpeech, setAiSpeech] = useState<string>(
    'Hello! Select any pulsing organ hotspot on the Claims Digital Twin (Heart or Lungs) to filter the priority review queue and fetch contextual AI audit assistance.'
  );

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getIngestedClaims(undefined, controller.signal),
      getAuditEvents(6, controller.signal),
    ]).then(([ingested, audit]) => {
      setClaims(datasetToClaimRows(ingested));
      setActivity(audit.events);
    }).catch(() => {
      // If server is not active or local claims are empty, fall back to self-contained mocks for seamless visual demonstration
      setClaims([...MOCK_CARDIAC_CLAIMS, ...MOCK_PULMONARY_CLAIMS, ...MOCK_OTHER_CLAIMS]);
      setActivity([]);
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  // Filter queue items dynamically based on the active anatomical hotspot selection
  const getFilteredQueue = () => {
    if (activeOrgan === 'heart') {
      return claims.filter(c => c.provider.toLowerCase().includes('heart') || c.rule?.toLowerCase().includes('r011') || c.rule?.toLowerCase().includes('r012') || c.id === 'CLM-10482' || c.id === 'CLM-10477');
    }
    if (activeOrgan === 'lungs') {
      return claims.filter(c => c.provider.toLowerCase().includes('clinic') || c.rule?.toLowerCase().includes('r008') || c.id === 'CLM-10479');
    }
    return claims.filter(c => c.status !== 'pass');
  };

  const filteredQueue = getFilteredQueue().slice(0, 5);

  const totalAnomalies = claims.reduce((total, claim) => total + (claim.findings || 0), 0);
  const reviewCount = claims.filter(c => c.status !== 'pass').length;
  const uncertainCount = claims.filter(c => c.status === 'uncertain').length;

  // Handle anatomical hotspot click handlers with contextual speech modifications
  const handleOrganSelect = (organ: 'all' | 'heart' | 'lungs') => {
    setActiveOrgan(organ);
    if (organ === 'heart') {
      setAiSpeech(
        'Cardiovascular filters applied (R011/R012). I detected high-frequency billing overlap on coronary procedures. Focus your audit review on pre-authorization references and surgical modifier modifiers.'
      );
    } else if (organ === 'lungs') {
      setAiSpeech(
        'Pulmonology filters applied (R008/R009). Warning: R008 indicates missing pre-authorization documentation for respiratory therapy line items.'
      );
    } else {
      setAiSpeech(
        'Filters reset. Displaying all claims in the active operational review queue. Select a hotspot on the 3D model above to narrow your inspection.'
      );
    }
  };

  return (
    <div className="min-h-screen bg-[#EBF0F5] text-[#0F172A] p-6 font-sans relative" style={{
      letterSpacing: '-0.01em'
    }}>
      
      <!-- Static Ambient Glowing Backgrounds -->
      <div className="absolute top-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-cyan-300/10 blur-[120px] pointer-events-none -z-10"></div>
      <div className="absolute bottom-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-blue-300/10 blur-[120px] pointer-events-none -z-10"></div>

      {/* 1. UPGRADED METRIC & KPI BANNER (Dashboard Header) */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <span className="text-[10px] text-cyan-600 font-extrabold uppercase tracking-widest block font-outfit">ClaimGuard AI Copilot</span>
          <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight mt-1 leading-none">
            Claims Operations
          </h1>
          <p className="text-sm text-[#64748B] mt-1.5 font-medium">
            Accumulated locally · <span className="font-bold text-slate-800">{reviewCount} claims</span> await reviewer decisions.
          </p>
        </div>
        
        {/* Date & Trigger Button */}
        <div className="flex items-center gap-3">
          <div className="px-4 py-2 bg-white border border-white/50 rounded-2xl shadow-sm text-xs font-semibold text-[#475569]">
            📆 Fri, Sep 25, 2026
          </div>
          <button
            onClick={() => onNavigate('review-queue')}
            className="px-5 py-2.5 bg-[#0F172A] hover:bg-slate-800 text-white rounded-2xl text-xs font-bold shadow-lg transform hover:-translate-y-0.5 transition-all duration-200"
          >
            Open Review Queue
          </button>
        </div>
      </div>

      {/* 2. ADVANCED KPI GLASS CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <!-- KPI 1 -->
        <div className="bg-white/80 backdrop-blur-md rounded-3xl p-5 border border-white/60 shadow-sm flex flex-col justify-between hover:shadow-md transition duration-200">
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Claims Processed</span>
            <span className="text-3xl font-extrabold text-[#0F172A] mt-1.5 block">{claims.length}</span>
          </div>
          <p className="text-[10px] text-slate-500 font-semibold mt-3 pt-2.5 border-t border-slate-900/5">
            Accumulated local cohort
          </p>
        </div>

        <!-- KPI 2 -->
        <div className="bg-white/80 backdrop-blur-md rounded-3xl p-5 border border-white/60 shadow-sm flex flex-col justify-between hover:shadow-md transition duration-200">
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Needs Active Review</span>
            <span className="text-3xl font-extrabold text-amber-600 mt-1.5 block">{reviewCount}</span>
          </div>
          <p className="text-[10px] text-[#64748B] font-semibold mt-3 pt-2.5 border-t border-slate-900/5">
            Failed or uncertain findings
          </p>
        </div>

        <!-- KPI 3 -->
        <div className="bg-white/80 backdrop-blur-md rounded-3xl p-5 border border-white/60 shadow-sm flex flex-col justify-between hover:shadow-md transition duration-200">
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Unable to Assess</span>
            <span className="text-3xl font-extrabold text-amber-500 mt-1.5 block">{uncertainCount}</span>
          </div>
          <p className="text-[10px] text-[#64748B] font-semibold mt-3 pt-2.5 border-t border-slate-900/5 font-mono">
            Awaiting supporting evidence
          </p>
        </div>

        <!-- KPI 4 -->
        <div className="bg-gradient-to-tr from-rose-500/10 to-amber-500/10 backdrop-blur-md rounded-3xl p-5 border border-rose-500/15 shadow-sm flex flex-col justify-between hover:shadow-md transition duration-200">
          <div>
            <span className="text-[10px] text-rose-500 font-bold uppercase tracking-wider block">Issues Detected</span>
            <span className="text-3xl font-extrabold text-rose-600 mt-1.5 block">{totalAnomalies}</span>
          </div>
          <p className="text-[10px] text-rose-700 font-bold mt-3 pt-2.5 border-t border-rose-500/10 font-outfit">
            R008 frequency high
          </p>
        </div>
      </div>

      {/* 3. MULTI-COLUMN DESIGN LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* LEFT COLUMN (Cols 7): Risk Profiling and Inconsistencies */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Methylation / Claim Billing Discrepancy Risk */}
            <div className="bg-white/90 backdrop-blur-md rounded-3xl p-6 border border-white/60 shadow-sm flex flex-col justify-between">
              <div>
                <div class="flex justify-between items-start mb-4">
                  <h3 className="font-bold text-xs uppercase tracking-wide text-[#0F172A]">Claim Discrepancy Risk</h3>
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[9px] font-bold">
                    Moderate Risk
                  </span>
                </div>

                <div className="flex items-baseline gap-2 mb-3">
                  <span className="text-3xl font-extrabold text-[#0F172A]">0.76</span>
                  <span className="text-xs text-[#64748B] font-medium">% / Audited Batch Avg</span>
                </div>

                {/* Risk Gauge Progress Bar */}
                <div className="relative w-full h-3.5 bg-slate-200 rounded-full overflow-visible mb-4">
                  <div className="absolute inset-0 rounded-full bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500"></div>
                  <div className="absolute top-1/2 -translate-y-1/2 left-[55%] -ml-1 w-2.5 h-5.5 bg-slate-950 border border-white rounded shadow"></div>
                </div>

                <p className="text-xs text-[#64748B] leading-relaxed mb-4">
                  This claim set shows an <span className="font-bold text-slate-800">18.4% billing mismatch risk</span>, triggered by cardiology and pulmonary pre-auth mismatches.
                </p>
              </div>

              <!-- Filter Badges / Controls -->
              <div class="pt-3 border-t border-slate-900/5 mt-2">
                <span className="text-[9px] text-[#94A3B8] font-bold uppercase block tracking-wider mb-2">Filter Operational Focus</span>
                <div className="flex flex-wrap gap-1.5">
                  <button 
                    onClick={() => handleOrganSelect(activeOrgan === 'heart' ? 'all' : 'heart')}
                    className={`px-2.5 py-1 text-[9px] font-bold rounded-lg border transition ${
                      activeOrgan === 'heart' 
                        ? 'bg-rose-100 text-rose-800 border-rose-300 shadow-sm' 
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    ● Cardiovascular
                  </button>
                  <button 
                    onClick={() => handleOrganSelect(activeOrgan === 'lungs' ? 'all' : 'lungs')}
                    className={`px-2.5 py-1 text-[9px] font-bold rounded-lg border transition ${
                      activeOrgan === 'lungs' 
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300 shadow-sm' 
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    ● Pulmonology
                  </button>
                </div>
              </div>
            </div>

            {/* "Why The Risk?" Rule Anomalies Card */}
            <div className="bg-white/90 backdrop-blur-md rounded-3xl p-6 border border-white/60 shadow-sm flex flex-col justify-between">
              <div>
                <h3 className="font-bold text-xs uppercase tracking-wide text-[#0F172A] mb-4">Trigger Inconsistencies</h3>
                
                <div className="space-y-3.5">
                  <div className="flex items-start gap-3">
                    <span className="w-5.5 h-5.5 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center mt-0.5"><i data-lucide="alert-circle" className="w-3.5 h-3.5"></i></span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-950">Auth Code Mismatch (R009)</span>
                        <span className="text-[8px] font-mono font-bold bg-rose-100 text-rose-800 px-1.5 py-0.2 rounded">Critical</span>
                      </div>
                      <p className="text-[10px] text-[#64748B] mt-0.5 leading-tight">Pre-authorization references do not coordinate with claim lines.</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="w-5.5 h-5.5 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center mt-0.5"><i data-lucide="copy" className="w-3.5 h-3.5"></i></span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-950">Duplicate Line Entry (R002)</span>
                        <span className="text-[8px] font-mono font-bold bg-orange-100 text-orange-800 px-1.5 py-0.2 rounded">Moderate</span>
                      </div>
                      <p className="text-[10px] text-[#64748B] mt-0.5 leading-tight">Line items contain identical service codes, dates, and amounts.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-900/5 mt-4">
                <span className="text-[9px] text-[#94A3B8] font-bold uppercase tracking-wider block font-outfit">Auditor Warning</span>
                <p className="text-[10px] text-[#64748B] mt-1 leading-normal">
                  R005 Surgical modifiers used repeatedly without primary procedures.
                </p>
              </div>
            </div>

          </div>

          {/* Epigenetic Disease Risk Profile -> Upgraded Billing Rule Profile */}
          <div className="flex flex-col gap-3.5">
            <h3 className="font-bold text-xs uppercase tracking-wide text-[#0F172A]">Billing Rule Diagnostic Profile</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              <!-- Card 1 -->
              <div className="bg-white/90 backdrop-blur-md rounded-2xl p-4.5 border border-white/60 border-l-4 border-rose-500 flex flex-col justify-between hover:shadow-md transition">
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-bold text-slate-950">Cardiovascular</span>
                    <span class="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-700 text-[8px] font-bold uppercase">Critical</span>
                  </div>
                  <div className="mb-3">
                    <span className="text-[9px] text-[#94A3B8] font-bold block uppercase tracking-wider">Failure Rate</span>
                    <span className="font-outfit font-extrabold text-lg text-rose-600">91% frequency</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-4">
                    <span className="px-1.5 py-0.5 font-mono text-[8px] font-bold bg-slate-100 rounded text-slate-500">R011</span>
                    <span className="px-1.5 py-0.5 font-mono text-[8px] font-bold bg-rose-100 text-rose-700 font-bold">R012</span>
                  </div>
                </div>
                <div className="pt-2.5 border-t border-slate-900/5">
                  <span className="text-[9px] text-cyan-600 font-extrabold uppercase block tracking-wider">Auditor Action</span>
                  <p className="text-[10px] text-[#64748B] leading-tight mt-1">Audit cardiology claims. Validate ICU coverage ranges.</p>
                </div>
              </div>

              <!-- Card 2 -->
              <div className="bg-white/90 backdrop-blur-md rounded-2xl p-4.5 border border-white/60 border-l-4 border-amber-500 flex flex-col justify-between hover:shadow-md transition">
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-bold text-slate-950">Pulmonology</span>
                    <span class="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 text-[8px] font-bold uppercase">Suboptimal</span>
                  </div>
                  <div className="mb-3">
                    <span className="text-[9px] text-[#94A3B8] font-bold block uppercase tracking-wider">Failure Rate</span>
                    <span className="font-outfit font-extrabold text-lg text-slate-900">44% frequency</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-4">
                    <span className="px-1.5 py-0.5 font-mono text-[8px] font-bold bg-slate-100 rounded text-slate-500">R008</span>
                    <span className="px-1.5 py-0.5 font-mono text-[8px] font-bold bg-slate-100 rounded text-slate-500">R009</span>
                  </div>
                </div>
                <div className="pt-2.5 border-t border-slate-900/5">
                  <span className="text-[9px] text-cyan-600 font-extrabold uppercase block tracking-wider">Auditor Action</span>
                  <p className="text-[10px] text-[#64748B] leading-tight mt-1">Review active authorization dates against line service dates.</p>
                </div>
              </div>

              <!-- Card 3 -->
              <div className="bg-white/90 backdrop-blur-md rounded-2xl p-4.5 border border-white/60 border-l-4 border-emerald-500 flex flex-col justify-between hover:shadow-md transition">
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-bold text-slate-950">General Medicine</span>
                    <span class="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 text-[8px] font-bold uppercase">Optimal</span>
                  </div>
                  <div className="mb-3">
                    <span className="text-[9px] text-[#94A3B8] font-bold block uppercase tracking-wider">Failure Rate</span>
                    <span className="font-outfit font-extrabold text-lg text-slate-900">12% frequency</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-4">
                    <span className="px-1.5 py-0.5 font-mono text-[8px] font-bold bg-slate-100 rounded text-slate-500">R001</span>
                    <span className="px-1.5 py-0.5 font-mono text-[8px] font-bold bg-slate-100 rounded text-slate-500">R003</span>
                  </div>
                </div>
                <div className="pt-2.5 border-t border-slate-900/5">
                  <span className="text-[9px] text-cyan-600 font-extrabold uppercase block tracking-wider">Auditor Action</span>
                  <p className="text-[10px] text-[#64748B] leading-tight mt-1">Passed checks. High-certainty results. No manual audit necessary.</p>
                </div>
              </div>

            </div>
          </div>

          {/* Table representing the filtered review queue */}
          <div className="bg-white/90 backdrop-blur-md rounded-3xl p-6 border border-white/60 shadow-sm mt-2">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-bold text-sm text-[#0F172A]">Priority Review Queue</h3>
                {activeOrgan !== 'all' && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-cyan-600 font-semibold mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse"></span>
                    Anatomical focus active: {activeOrgan.toUpperCase()}
                  </span>
                )}
              </div>
              {activeOrgan !== 'all' && (
                <button 
                  onClick={() => handleOrganSelect('all')}
                  className="text-xs text-blue-600 font-bold hover:underline"
                >
                  Reset Hotspots
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-900/5 text-[#94A3B8] font-bold">
                    <th className="pb-2">Claim ID</th>
                    <th className="pb-2">Provider</th>
                    <th className="pb-2">Billed Amount</th>
                    <th className="pb-2">Primary Failure</th>
                    <th className="pb-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900/5">
                  {filteredQueue.map(c => (
                    <tr 
                      key={c.id} 
                      onClick={() => onNavigate('claim-review', c.id)}
                      className="hover:bg-slate-50/50 cursor-pointer transition duration-150"
                    >
                      <td className="py-3 font-semibold text-[#0F172A]">{c.id}</td>
                      <td className="py-3 text-[#475569]">{c.provider}</td>
                      <td className="py-3 font-mono font-semibold text-[#475569]">{c.amount || '$1,200.00'}</td>
                      <td className="py-3 text-rose-600 font-medium text-[11px]">{c.rule || 'R008 · Pre-Auth Warning'}</td>
                      <td className="py-3 text-right">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                          c.status === 'review' 
                            ? 'bg-amber-50 text-amber-700 border border-amber-200' 
                            : c.status === 'fail' 
                              ? 'bg-rose-50 text-rose-700 border border-rose-200' 
                              : 'bg-orange-50 text-orange-700 border border-orange-200'
                        }`}>
                          {c.status.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN (Cols 5): Interactive Digital Twin Organ Mapper */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          
          <div className="bg-white/90 backdrop-blur-md rounded-3xl p-6 border border-white/60 shadow-sm relative overflow-hidden flex flex-col justify-between h-full min-h-[580px]">
            
            {/* Ambient Background Glow for Twin */}
            <div className="absolute bottom-[-20%] right-[-20%] w-60 h-60 bg-cyan-400/10 rounded-full filter blur-2xl pointer-events-none"></div>

            <div>
              <h3 className="font-bold text-sm text-[#0F172A] mb-1">Interactive Claims Twin</h3>
              <p className="text-[11px] text-[#64748B] leading-relaxed mb-6">
                Claims diagnostic systems map billing codes to an anatomical model. Pulses indicate anomalies flagged inside specialized cardiac or pulmonic billing codes.
              </p>
            </div>

            {/* Stylized Human Vector SVG Renderer with Glowing Hotspots */}
            <div className="relative flex items-center justify-center w-full min-h-[360px] border border-white/40 bg-white/40 rounded-2xl p-4">
              
              <!-- Floating Zoom and Control Buttons -->
              <div className="absolute top-4 left-4 flex flex-col gap-1.5">
                <button className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-900 shadow-sm transition"><i data-lucide="plus" className="w-4 h-4"></i></button>
                <button className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-900 shadow-sm transition"><i data-lucide="minus" className="w-4 h-4"></i></button>
                <button className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-900 shadow-sm transition"><i data-lucide="expand" className="w-4 h-4"></i></button>
              </div>

              <!-- Stylized Human Body SVG Map with Hotspots -->
              <div className="relative w-44 h-80 flex items-center justify-center">
                <!-- Outer Body SVG -->
                <svg className="w-full h-full text-slate-300 opacity-80" viewBox="0 0 100 220" fill="currentColor">
                  <path d="M50,10 C56,10 60,14 60,20 C60,26 56,30 50,30 C44,30 40,26 40,20 C40,14 44,10 50,10 Z M50,32 C42,32 30,36 30,48 L30,90 L34,140 L42,210 L50,210 L58,210 L66,140 L70,90 L70,48 C70,36 58,32 50,32 Z"/>
                </svg>

                {/* HEART HOTSPOT: Cardiological Billing risk (72%) */}
                <button 
                  onClick={() => handleOrganSelect('heart')}
                  className="absolute top-[28%] left-[44%] -translate-x-1/2 -translate-y-1/2 z-20 group outline-none"
                >
                  <span className="relative flex h-7.5 w-7.5">
                    <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      activeOrgan === 'heart' ? 'animate-ping bg-rose-500' : 'animate-pulse bg-rose-400'
                    }`}></span>
                    <span className={`relative inline-flex rounded-full h-7.5 w-7.5 text-[9px] text-white font-extrabold items-center justify-center shadow-lg transition-all transform hover:scale-110 ${
                      activeOrgan === 'heart' ? 'bg-slate-950 ring-2 ring-rose-500 scale-105' : 'bg-rose-500'
                    }`}>
                      72%
                    </span>
                  </span>
                  {/* Tooltip Hover Overlay */}
                  <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block bg-slate-900 text-white text-[9px] rounded py-1 px-2 shadow-lg w-28 text-center pointer-events-none">
                    <strong>Cardiology Focus</strong><br>Click to filter queue
                  </span>
                </button>

                {/* LUNG HOTSPOT: Pulmonology Billing Risk (15%) */}
                <button 
                  onClick={() => handleOrganSelect('lungs')}
                  className="absolute top-[36%] left-[54%] -translate-x-1/2 -translate-y-1/2 z-20 group outline-none"
                >
                  <span className="relative flex h-6 w-6">
                    <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      activeOrgan === 'lungs' ? 'animate-ping bg-emerald-500' : 'animate-pulse bg-emerald-400'
                    }`}></span>
                    <span className={`relative inline-flex rounded-full h-6 w-6 text-[8px] text-white font-extrabold items-center justify-center shadow-lg transition-all transform hover:scale-110 ${
                      activeOrgan === 'lungs' ? 'bg-slate-950 ring-2 ring-emerald-500 scale-105' : 'bg-emerald-500'
                    }`}>
                      15%
                    </span>
                  </span>
                  {/* Tooltip Hover Overlay */}
                  <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block bg-slate-900 text-white text-[9px] rounded py-1 px-2 shadow-lg w-28 text-center pointer-events-none">
                    <strong>Pulmonary Focus</strong><br>Click to filter queue
                  </span>
                </button>

                {/* Heart aura pulse effect */}
                <div className={`absolute top-[28%] left-[44%] -translate-x-1/2 -translate-y-1/2 w-14 h-14 border border-rose-500/20 rounded-full pointer-events-none ${
                  activeOrgan === 'heart' ? 'animate-ping' : 'animate-pulse'
                }`}></div>
              </div>

            </div>

            {/* INTEGRATED AI DIALOG ASSISTANT PANEL */}
            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4.5 mt-2 relative">
              <span className="text-[9px] text-[#94A3B8] font-bold uppercase block tracking-wider mb-1.5 font-outfit">Active AI Auditor Counsel</span>
              <p className="text-xs text-[#475569] leading-relaxed pr-10">
                "{aiSpeech}"
              </p>
              
              {/* Floating Sparkle indicator icon */}
              <div className="absolute bottom-4 right-4 text-cyan-500">
                <i data-lucide="sparkles" className="w-5.5 h-5.5 animate-pulse"></i>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-900/5 text-[10px] text-slate-400 font-semibold flex justify-between items-center mt-4">
              <span>Simulation Mode: Claims Twin-v1.0</span>
              <span className="text-emerald-600 flex items-center gap-1">● Automated Diagnostics Synced</span>
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}
