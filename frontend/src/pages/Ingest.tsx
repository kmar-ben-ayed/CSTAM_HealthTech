import { useState, useRef, useCallback } from 'react';
import Sentinel from '../components/Sentinel';
import { ApiError } from '../api/client';
import { ingestCsv, ingestFhir, ingestJsonl, type IngestionResponse, type RejectedRecord } from '../api/ingestion';
import type { BackendClaim } from '../api/claims';

interface IngestProps {
  onNavigate: (page: string) => void;
}

type IngestStep = 'idle' | 'selected' | 'validated' | 'processing' | 'complete';

type PreviewRow = { id: string; provider: string; service: string; amount: string; dos: string; policy: string };
type ValidationIssue = { row: number | string; field: string; issue: string; severity: string };

const PROCESSING_STEPS = [
  { label: 'Preparing claims', detail: 'Parsing records', done: true },
  { label: 'Normalizing data', detail: 'FHIR R4 mapping', done: true },
  { label: 'Applying validation rules', detail: '15 rules · v1.0.0', done: false },
  { label: 'Creating findings', detail: 'Extracting evidence', done: false },
];

const PREVIEW_ROWS = [
  { id: 'CLM-10490', provider: 'Meridian Health', service: '99213', amount: '$150.00', dos: '2026-09-27', policy: 'EDU-BASIC' },
  { id: 'CLM-10491', provider: 'Pacific Medical', service: '90686', amount: '$25.00', dos: '2026-09-27', policy: 'EDU-PLUS' },
  { id: 'CLM-10492', provider: 'Northside Clinic', service: '99214', amount: '$210.00', dos: '2026-09-26', policy: 'EDU-BASIC' },
  { id: 'CLM-10493', provider: 'Eastern Group', service: '71046', amount: '$340.00', dos: '2026-09-25', policy: 'EDU-PLUS' },
  { id: 'CLM-10494', provider: 'Metro Health', service: '99203', amount: '$180.00', dos: '2026-09-25', policy: 'EDU-BASIC' },
];

const VALIDATION_ISSUES = [
  { row: 7, field: 'authorization.reference', issue: 'Missing required field', severity: 'WARNING' },
  { row: 9, field: 'member.plan_id', issue: 'Unrecognized plan identifier', severity: 'ERROR' },
];

const REQUIRED_CSV_FILES = ['claims.csv', 'lines.csv', 'coverage.csv', 'authorizations.csv', 'attachments.csv'];

function toPreviewRow(claim: BackendClaim): PreviewRow {
  const line = claim.lines?.[0];
  const amount = claim.total_amount === undefined
    ? '—'
    : new Intl.NumberFormat('en', { style: 'currency', currency: claim.currency || 'SAR' }).format(claim.total_amount);
  return {
    id: claim.claim_id,
    provider: claim.provider_id || '—',
    service: line?.service_code || '—',
    amount,
    dos: line?.service_date || '—',
    policy: claim.policy_id || '—',
  };
}

function toValidationIssues(rejected: RejectedRecord[]): ValidationIssue[] {
  return rejected.flatMap((record) => record.findings.length
    ? record.findings.map((finding) => ({
      row: record.index === null ? '—' : record.index + 1,
      field: finding.path || record.reason,
      issue: finding.message || record.reason,
      severity: finding.severity?.toUpperCase() || 'ERROR',
    }))
    : [{ row: record.index === null ? '—' : record.index + 1, field: record.reason, issue: record.reason, severity: 'ERROR' }]);
}

const FORMAT_CARDS = [
  {
    label: 'CSV',
    desc: 'Tabular claim dataset',
    ext: '.csv',
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="2" y="2" width="18" height="18" rx="3" stroke="#287a5f" strokeWidth="1.4"/>
        <path d="M2 7h18M7 7v13" stroke="#287a5f" strokeWidth="1.4"/>
        <path d="M5 11h2M11 11h4M5 14.5h2M11 14.5h4" stroke="#287a5f" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    label: 'JSON',
    desc: 'Structured claim data',
    ext: '.json',
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M6 4C4.5 4 4 4.5 4 6v3c0 1-1 2-1 2s1 1 1 2v3c0 1.5.5 2 2 2" stroke="#315e8a" strokeWidth="1.4" strokeLinecap="round"/>
        <path d="M16 4c1.5 0 2 .5 2 2v3c0 1 1 2 1 2s-1 1-1 2v3c0 1.5-.5 2-2 2" stroke="#315e8a" strokeWidth="1.4" strokeLinecap="round"/>
        <circle cx="11" cy="11" r="1.5" fill="#315e8a"/>
      </svg>
    ),
  },
  {
    label: 'FHIR',
    desc: 'FHIR Claim resource',
    ext: '.json',
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M11 2l8 4v5c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6l8-4z" stroke="#10b981" strokeWidth="1.4" strokeLinejoin="round"/>
        <path d="M8 11l2 2 4-4" stroke="#10b981" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
];

export default function Ingest({ onNavigate }: IngestProps) {
  const [step, setStep] = useState<IngestStep>('idle');
  const [dragging, setDragging] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<'upload' | 'paste' | 'fhir'>('upload');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [selectedFileNames, setSelectedFileNames] = useState<string[]>([]);
  const [csvFiles, setCsvFiles] = useState<Record<string, string>>({});
  const [filesLoading, setFilesLoading] = useState(false);
  const [recordCount, setRecordCount] = useState(0);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [ingestionResult, setIngestionResult] = useState<IngestionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processingStep, setProcessingStep] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectFiles = useCallback((files: File[]) => {
    if (!files.length) return;
    const filesToRead = selectedFormat === 'upload' ? files : files.slice(0, 1);
    setSelectedFileNames(filesToRead.map(file => file.name));
    setFileName(filesToRead.length === 1 ? filesToRead[0].name : `${filesToRead.length} files selected`);
    setFileSize(`${(filesToRead.reduce((total, file) => total + file.size, 0) / 1024 / 1024).toFixed(2)} MB`);
    setError(null);
    setFileContent('');
    setCsvFiles({});
    setFilesLoading(true);
    setStep('selected');
    Promise.all(filesToRead.map(async file => ({ name: file.name, content: await file.text() })))
      .then(contents => {
        setFileContent(contents[0]?.content || '');
        setCsvFiles(Object.fromEntries(contents
          .filter(file => file.name.toLowerCase().endsWith('.csv'))
          .map(file => [file.name, file.content])));
      })
      .catch(() => setError('The selected file(s) could not be read.'))
      .finally(() => setFilesLoading(false));
  }, [selectedFormat]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    selectFiles(Array.from(e.dataTransfer.files));
  }, [selectFiles]);

  const isCsvUpload = selectedFormat === 'upload' && selectedFileNames.some(name => name.toLowerCase().endsWith('.csv'));
  const selectedCsvFileCount = selectedFileNames.filter(name => name.toLowerCase().endsWith('.csv')).length;
  const missingCsvFiles = REQUIRED_CSV_FILES.filter(name => !Object.prototype.hasOwnProperty.call(csvFiles, name));
  const unsupportedCsvFiles = isCsvUpload
    ? selectedFileNames.filter(name => !name.toLowerCase().endsWith('.csv'))
    : [];

  const handleValidate = async () => {
    if (filesLoading) return;
    if (isCsvUpload && unsupportedCsvFiles.length) {
      setError(`CSV packs can only contain CSV files. Remove: ${unsupportedCsvFiles.join(', ')}`);
      return;
    }
    if (isCsvUpload && missingCsvFiles.length) {
      setError(`CSV pack incomplete. Missing CSV files: ${missingCsvFiles.join(', ')}`);
      return;
    }
    if (!isCsvUpload && !fileContent.trim()) {
      setError('The selected file is empty.');
      return;
    }
    setError(null);
    setStep('processing');
    setProcessingStep(1);
    try {
      const result = selectedFormat === 'fhir'
        ? await ingestFhir(fileContent)
        : isCsvUpload
          ? await ingestCsv(csvFiles)
          : await ingestJsonl(fileContent);
      setIngestionResult(result);
      setPreviewRows(result.claims.slice(0, 5).map(toPreviewRow));
      setValidationIssues(toValidationIssues(result.rejected));
      setRecordCount(result.claims.length + result.rejected.length);
      setProcessingStep(4);
      setStep('validated');
    } catch (cause: unknown) {
      setStep('selected');
      setError(cause instanceof ApiError ? cause.message : 'The backend could not process this file.');
    }
  };

  const handleProcess = () => {
    if (ingestionResult) setStep('complete');
  };

  const handleReset = () => {
    setStep('idle');
    setProcessingStep(0);
    setFileName('');
    setFileSize('');
    setFileContent('');
    setSelectedFileNames([]);
    setCsvFiles({});
    setFilesLoading(false);
    setRecordCount(0);
    setPreviewRows([]);
    setValidationIssues([]);
    setIngestionResult(null);
    setError(null);
  };

  const rejectedCount = ingestionResult?.rejected.length || 0;
  const acceptedCount = ingestionResult?.claims.length || 0;
  const reviewCount = ingestionResult
    ? Object.values(ingestionResult.evaluations).filter((results) => results.some((result) => result.requires_human_review)).length
    : 0;

  return (
    <div className="page-shell">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em', color: '#0f172a', marginBottom: 4 }}>Ingest Data</h1>
          <p style={{ fontSize: '0.9rem', color: '#64748b' }}>Import claim data into ClaimGuard for validation and review.</p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginRight: 4 }}>Supported formats:</span>
          {['CSV', 'JSON', 'FHIR'].map(f => (
            <span key={f} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6875rem', fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-subtle)', border: '1px solid var(--status-pass-border)', borderRadius: 4, padding: '3px 9px' }}>{f}</span>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#be123c', fontSize: '0.8125rem' }}>
          <strong>Ingestion failed:</strong> {error}
        </div>
      )}

      {/* COMPLETE STATE */}
      {step === 'complete' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ background: '#fff', border: '1px solid #a7f3d0', borderRadius: 10, padding: '28px 32px', boxShadow: 'var(--card-shadow)', display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            <Sentinel state="pass" size={64} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: 6 }}>Ingestion complete</div>
              <div style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: 20 }}>{acceptedCount} claims processed · Backend evaluation complete</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: 16, marginBottom: 20 }}>
                {[
                  { label: 'Accepted claims', value: String(acceptedCount), color: 'var(--accent)' },
                  { label: 'Rejected records', value: String(rejectedCount), color: '#f43f5e' },
                  { label: 'Require review', value: String(reviewCount), color: 'var(--status-review)' },
                ].map(s => (
                  <div key={s.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 16px', textAlign: 'center' }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', fontWeight: 700, color: s.color, letterSpacing: '-0.03em' }}>{s.value}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 3 }}>{s.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => onNavigate('claims')} style={{ background: '#0f172a', border: 'none', borderRadius: 7, padding: '9px 20px', color: '#fff', fontSize: '0.875rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  View claims
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7h9M8 4l3.5 3L8 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                <button onClick={() => onNavigate('runs')} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7, padding: '9px 20px', color: '#475569', fontSize: '0.875rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>View runs</button>
                <button onClick={() => onNavigate('audit')} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7, padding: '9px 20px', color: '#475569', fontSize: '0.875rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>View audit event</button>
                <button onClick={handleReset} style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '0.875rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, padding: '9px 12px' }}>Ingest another file</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PROCESSING STATE */}
      {step === 'processing' && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '40px', boxShadow: 'var(--card-shadow)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
          <Sentinel state="scanning" size={80} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: 4 }}>Processing claims…</div>
            <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>{fileName} · {recordCount} records</div>
          </div>
          <div style={{ width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 0 }}>
            {PROCESSING_STEPS.map((s, i) => {
              const isDone = processingStep > i;
              const isActive = processingStep === i;
              return (
                <div key={i}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 14px',
                    borderRadius: 8,
                    background: isActive ? 'rgba(6,182,212,0.05)' : 'transparent',
                    border: isActive ? '1px solid rgba(6,182,212,0.15)' : '1px solid transparent',
                    transition: 'all 0.2s ease',
                  }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isDone ? 'var(--status-pass-bg)' : isActive ? 'var(--accent-subtle)' : 'var(--canvas-bg)', border: `1.5px solid ${isDone ? 'var(--status-pass)' : isActive ? 'var(--accent)' : 'var(--border)'}`, transition: 'all 0.2s ease' }}>
                      {isDone ? (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5 4.5-5" stroke="#10b981" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      ) : isActive ? (
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', animation: 'sentinel-pulse 1s ease-in-out infinite' }} />
                      ) : (
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#e2e8f0' }} />
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: isDone ? '#059669' : isActive ? '#0f172a' : '#94a3b8', transition: 'color 0.2s ease' }}>{s.label}</div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 1 }}>{s.detail}</div>
                    </div>
                  </div>
                  {i < PROCESSING_STEPS.length - 1 && (
                    <div style={{ display: 'flex', justifyContent: 'center', paddingLeft: 23 }}>
                      <div style={{ width: 1, height: 10, background: isDone ? '#a7f3d0' : '#f1f5f9' }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VALIDATED STATE */}
      {step === 'validated' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* File info row */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px 20px', boxShadow: 'var(--card-shadow)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: '#ecfdf5', border: '1px solid #a7f3d0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 2h8l4 4v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="#10b981" strokeWidth="1.3" strokeLinejoin="round"/><path d="M11 2v4h4" stroke="#10b981" strokeWidth="1.3"/></svg>
              </div>
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a', fontFamily: "'JetBrains Mono', monospace" }}>{fileName}</div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>CSV · {fileSize} · {recordCount} records</div>
              </div>
            </div>
            <button onClick={handleReset} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8125rem', fontFamily: 'inherit', fontWeight: 500 }}>Remove</button>
          </div>

          {/* Validation result */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: 2 }}>Ingestion validation</h3>
                <p style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>Format validation complete. Review issues before processing.</p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {[
                  { label: `${acceptedCount} valid`, color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0' },
                  { label: `${rejectedCount} invalid`, color: '#f43f5e', bg: '#fff1f2', border: '#fecdd3' },
                  { label: `${validationIssues.filter(i => i.severity === 'WARNING').length} warnings`, color: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
                ].map(s => (
                  <span key={s.label} style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: 6, padding: '4px 10px', fontSize: '0.75rem', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{s.label}</span>
                ))}
              </div>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Issues requiring attention</div>
              <table className="data-table" style={{ marginBottom: 0 }}>
                <thead><tr><th>Row</th><th>Field</th><th>Issue</th><th>Severity</th></tr></thead>
                <tbody>
                  {validationIssues.map((issue, i) => (
                    <tr key={i}>
                      <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{issue.row}</span></td>
                      <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem', color: '#475569' }}>{issue.field}</span></td>
                      <td><span style={{ fontSize: '0.875rem', color: '#334155' }}>{issue.issue}</span></td>
                      <td>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.06em', borderRadius: 4, padding: '2px 8px', background: issue.severity === 'ERROR' ? '#fff1f2' : '#fffbeb', color: issue.severity === 'ERROR' ? '#e11d48' : '#b45309', border: `1px solid ${issue.severity === 'ERROR' ? '#fecdd3' : '#fde68a'}` }}>
                          {issue.severity}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Data preview */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: 2 }}>Data preview</h3>
              <p style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>Showing first 5 of {recordCount} records</p>
            </div>
            <table className="data-table">
              <thead><tr><th>Claim ID</th><th>Provider</th><th>Service code</th><th>Amount</th><th>Service date</th><th>Policy</th></tr></thead>
              <tbody>
                {previewRows.map(row => (
                  <tr key={row.id}>
                    <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem', fontWeight: 700, color: 'var(--accent)' }}>{row.id}</span></td>
                    <td><span style={{ fontSize: '0.875rem', color: '#334155' }}>{row.provider}</span></td>
                    <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.875rem', color: '#475569' }}>{row.service}</span></td>
                    <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{row.amount}</span></td>
                    <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem', color: '#64748b' }}>{row.dos}</span></td>
                    <td><span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6875rem', fontWeight: 700, color: row.policy === 'EDU-BASIC' ? 'var(--accent)' : 'var(--status-review)', background: row.policy === 'EDU-BASIC' ? 'var(--accent-subtle)' : 'var(--status-review-bg)', border: `1px solid ${row.policy === 'EDU-BASIC' ? 'var(--status-pass-border)' : 'var(--status-review-border)'}`, borderRadius: 4, padding: '2px 7px' }}>{row.policy}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={handleReset} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7, padding: '9px 20px', color: '#475569', fontSize: '0.875rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>Cancel</button>
            <button onClick={handleProcess} style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '9px 24px', color: '#fff', fontSize: '0.875rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
              Start processing
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l6 4-6 4V3z" fill="currentColor"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* FILE SELECTED STATE */}
      {step === 'selected' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* File card */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px', boxShadow: 'var(--card-shadow)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 44, height: 44, borderRadius: 9, background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 3h8l5 5v9a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="var(--accent)" strokeWidth="1.3" strokeLinejoin="round"/><path d="M12 3v5h5" stroke="var(--accent)" strokeWidth="1.3"/></svg>
                </div>
                <div>
                  <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a', fontFamily: "'JetBrains Mono', monospace", marginBottom: 3 }}>{fileName}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6875rem', fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-subtle)', border: '1px solid var(--status-pass-border)', borderRadius: 4, padding: '1px 7px' }}>CSV</span>
                    <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>{fileSize}</span>
                    <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>·</span>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#334155' }}>
                      {isCsvUpload ? `${selectedCsvFileCount} CSV file${selectedCsvFileCount === 1 ? '' : 's'} selected` : 'Ready to validate'}
                    </span>
                  </div>
                </div>
              </div>
              <button onClick={handleReset} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8125rem', fontFamily: 'inherit', fontWeight: 500, padding: '4px 8px' }}>Remove</button>
            </div>
            {isCsvUpload ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: missingCsvFiles.length ? '#92400e' : '#334155' }}>
                  {filesLoading ? 'Reading selected files…' : `${REQUIRED_CSV_FILES.length - missingCsvFiles.length} of ${REQUIRED_CSV_FILES.length} required CSV files selected`}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {REQUIRED_CSV_FILES.map(name => {
                    const isSelected = filesLoading
                      ? selectedFileNames.includes(name)
                      : Object.prototype.hasOwnProperty.call(csvFiles, name);
                    return (
                      <span key={name} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6875rem', color: isSelected ? 'var(--accent)' : '#92400e', background: isSelected ? 'var(--accent-subtle)' : '#fffbeb', border: `1px solid ${isSelected ? 'var(--status-pass-border)' : '#fde68a'}`, borderRadius: 4, padding: '3px 7px' }}>
                        {isSelected ? '✓' : 'Missing: '}{name}
                      </span>
                    );
                  })}
                </div>
                {unsupportedCsvFiles.length > 0 && (
                  <div style={{ fontSize: '0.8125rem', color: '#92400e' }}>
                    Remove non-CSV files from this pack: {unsupportedCsvFiles.join(', ')}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--status-pass)' }}>✓</span>
                  <span style={{ fontSize: '0.8125rem', color: '#334155' }}>File selected</span>
                </div>
                {filesLoading && <div style={{ fontSize: '0.8125rem', color: '#64748b' }}>Reading file…</div>}
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={handleReset} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7, padding: '9px 20px', color: '#475569', fontSize: '0.875rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>Cancel</button>
            <button onClick={handleValidate} disabled={filesLoading} style={{ background: '#0f172a', border: 'none', borderRadius: 7, padding: '9px 24px', color: '#fff', fontSize: '0.875rem', cursor: filesLoading ? 'wait' : 'pointer', fontFamily: 'inherit', fontWeight: 600, opacity: filesLoading ? 0.7 : 1 }}>Validate & Preview →</button>
          </div>
        </div>
      )}

      {/* IDLE STATE */}
      {step === 'idle' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Source selector */}
          <div style={{ display: 'flex', gap: 2, background: '#f1f5f9', borderRadius: 8, padding: 3, width: 'fit-content' }}>
            {[
              { key: 'upload' as const, label: 'Upload file' },
              { key: 'paste' as const, label: 'Paste JSON' },
              { key: 'fhir' as const, label: 'FHIR resource' },
            ].map(s => (
              <button
                key={s.key}
                onClick={() => setSelectedFormat(s.key)}
                style={{ background: selectedFormat === s.key ? '#fff' : 'transparent', border: selectedFormat === s.key ? '1px solid #e2e8f0' : '1px solid transparent', borderRadius: 6, padding: '6px 16px', fontSize: '0.875rem', color: selectedFormat === s.key ? '#0f172a' : '#64748b', cursor: 'pointer', fontFamily: 'inherit', fontWeight: selectedFormat === s.key ? 600 : 400, transition: 'all 0.15s ease', boxShadow: selectedFormat === s.key ? '0 1px 3px rgba(0,0,0,0.06)' : 'none' }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Drop zone */}
          <div
            onDragEnter={() => setDragging(true)}
            onDragLeave={() => setDragging(false)}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              background: dragging ? 'rgba(6,182,212,0.04)' : '#fff',
              border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 12,
              padding: '64px 40px',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              accept=".csv,.json"
              multiple={selectedFormat === 'upload'}
              onChange={e => {
                selectFiles(Array.from(e.target.files || []));
                e.currentTarget.value = '';
              }}
            />
            <div style={{ width: 56, height: 56, borderRadius: 12, background: dragging ? 'rgba(6,182,212,0.1)' : '#f8fafc', border: `1.5px solid ${dragging ? 'rgba(6,182,212,0.3)' : '#e2e8f0'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s ease' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 3v12M8 9l4-6 4 6" stroke={dragging ? 'var(--accent)' : '#74847c'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" stroke={dragging ? 'var(--accent)' : '#74847c'} strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: 4 }}>
                {selectedFormat === 'upload' ? 'Drop a CSV pack or claim file here' : 'Drop your claim file here'}
              </div>
              <div style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: 16 }}>
                {selectedFormat === 'upload' ? 'For CSV, select all five related files together.' : 'or choose a file from your computer'}
              </div>
              <button
                onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '9px 24px', color: '#fff', fontSize: '0.875rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
              >
                Browse files
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
              <span style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>Supported:</span>
              {['.csv', '.json', 'FHIR Claim data'].map(f => (
                <span key={f} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6875rem', color: '#94a3b8', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, padding: '1px 7px' }}>{f}</span>
              ))}
            </div>
          </div>

          {/* Format cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {FORMAT_CARDS.map(fc => (
              <div
                key={fc.label}
                style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 9, padding: '16px 18px', display: 'flex', gap: 14, alignItems: 'flex-start', transition: 'all 0.15s ease', cursor: 'default' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.boxShadow = 'var(--card-shadow-md)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {fc.icon}
                </div>
                <div>
                  <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.01em', marginBottom: 3 }}>{fc.label}</div>
                  <div style={{ fontSize: '0.8125rem', color: '#64748b' }}>{fc.desc}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: '#94a3b8', marginTop: 6 }}>{fc.ext}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
