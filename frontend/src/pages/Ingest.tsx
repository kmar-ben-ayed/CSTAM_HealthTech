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

const CSV_PACK_FILES = ['claims.csv', 'lines.csv', 'coverage.csv', 'authorizations.csv', 'attachments.csv'] as const;

const PROCESSING_STEPS = [
  { label: 'Preparing claims', detail: 'Parsing records', done: true },
  { label: 'Normalizing data', detail: 'FHIR R4 mapping', done: true },
  { label: 'Applying validation rules', detail: '15 rules · v1.0.0', done: false },
  { label: 'Creating findings', detail: 'Extracting evidence', done: false },
];

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

function isFhirBundle(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isFhirBundle);
  return typeof value === 'object' && value !== null && 'resourceType' in value
    && value.resourceType === 'Bundle';
}

function isFhirBundlePayload(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  try {
    return isFhirBundle(JSON.parse(trimmed));
  } catch {
    return trimmed.split(/\r?\n/).some((line) => {
      if (!line.trim()) return false;
      try {
        return isFhirBundle(JSON.parse(line));
      } catch {
        return false;
      }
    });
  }
}

function toValidationIssues(rejected: RejectedRecord[], fhirFindings: IngestionResponse['fhir_findings'] = []): ValidationIssue[] {
  const rejectedIssues = rejected.flatMap((record) => record.findings.length
    ? record.findings.map((finding) => ({
      row: record.index === null ? '—' : record.index + 1,
      field: finding.path || record.reason,
      issue: finding.message || record.reason,
      severity: finding.severity?.toUpperCase() || 'ERROR',
    }))
    : [{ row: record.index === null ? '—' : record.index + 1, field: record.reason, issue: record.reason, severity: 'ERROR' }]);

  const structuralIssues = (fhirFindings || []).flatMap((entry) =>
    (entry.findings as Array<{ severity?: string; code?: string; message?: string; path?: string }>).map((finding) => ({
      row: entry.claim_id,
      field: finding.path || finding.code || 'FHIR structure',
      issue: finding.message || finding.code || 'FHIR structural finding',
      severity: finding.severity?.toUpperCase() || 'WARNING',
    })));

  return [...rejectedIssues, ...structuralIssues];
}

const FORMAT_CARDS = [
  {
    label: 'CSV',
    desc: 'Tabular claim dataset',
    ext: '.csv',
  },
  {
    label: 'JSON',
    desc: 'Structured claim data',
    ext: '.json, .jsonl',
  },
  {
    label: 'FHIR',
    desc: 'FHIR Claim resource',
    ext: '.json, .jsonl',
  },
];

export default function Ingest({ onNavigate }: IngestProps) {
  const [step, setStep] = useState<IngestStep>('idle');
  const [dragging, setDragging] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<'upload' | 'paste' | 'fhir'>('upload');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [csvFiles, setCsvFiles] = useState<Record<string, string>>({});
  const [csvUnrecognized, setCsvUnrecognized] = useState<string[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [recordCount, setRecordCount] = useState(0);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [ingestionResult, setIngestionResult] = useState<IngestionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processingStep, setProcessingStep] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addMoreInputRef = useRef<HTMLInputElement>(null);

  const isCsvMode = Object.keys(csvFiles).length > 0;
  const csvReady = CSV_PACK_FILES.every((name) => csvFiles[name]);

const selectFiles = useCallback((fileList?: FileList | File[] | null) => {
  const files = fileList ? Array.from(fileList) : [];
  if (!files.length) return;
  setError(null);

  const csvOnes = files.filter((f) => f.name.toLowerCase().endsWith('.csv'));
  if (csvOnes.length > 0) {
    setFileContent('');
    setFileName('');
    setFileSize('');
    Promise.all(csvOnes.map((f) => f.text().then((text) => [f.name, text] as const)))
      .then((entries) => {
        const recognized: Record<string, string> = {};
        const unrecognized: string[] = [];
        for (const [name, text] of entries) {
          const canonical = CSV_PACK_FILES.find((c) => c === name.toLowerCase());
          if (canonical) recognized[canonical] = text;
          else unrecognized.push(name);
        }
        setCsvFiles((prev) => ({ ...prev, ...recognized }));
        setCsvUnrecognized(unrecognized);
      })
      .catch(() => setError('One of the selected CSV files could not be read.'));
    setStep('selected');
    return;
  }

  const file = files[0];
  setCsvFiles({});
  setCsvUnrecognized([]);
  setFileName(file.name);
  setFileSize(`${(file.size / 1024 / 1024).toFixed(2)} MB`);
  file.text().then(setFileContent).catch(() => setError('The selected file could not be read.'));
  setStep('selected');
}, []);

  const usePastedText = () => {
    if (!pasteText.trim()) return;
    setCsvFiles({});
    setCsvUnrecognized([]);
    setFileName(selectedFormat === 'fhir' ? 'Pasted FHIR bundle' : 'Pasted JSON');
    setFileSize(`${(new Blob([pasteText]).size / 1024).toFixed(1)} KB`);
    setFileContent(pasteText);
    setError(null);
    setStep('selected');
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    selectFiles(e.dataTransfer.files);
  }, [selectFiles]);
  const handleValidate = async () => {
    if (isCsvMode ? !csvReady : !fileContent) return;
    setError(null);
    setStep('processing');
    setProcessingStep(1);
    try {

      const result = isCsvMode
        ? await ingestCsv(csvFiles)
        : isFhirImport
          ? await ingestFhir(fileContent)
          : await ingestJsonl(fileContent);
      setIngestionResult(result);
      setPreviewRows(result.claims.slice(0, 5).map(toPreviewRow));
      setValidationIssues(toValidationIssues(result.rejected, result.fhir_findings));
      setRecordCount(result.claims.length + result.rejected.length);
      setProcessingStep(4);
      setStep('validated');
    } catch (cause: unknown) {
      setStep('selected');
      setError(cause instanceof ApiError ? cause.message : 'The backend could not process this input.');
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

    setCsvFiles({});
    setCsvUnrecognized([]);
    setPasteText('');
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
  const isFhirImport = selectedFormat === 'fhir' || (!isCsvMode && isFhirBundlePayload(fileContent));
  const formatLabel = isCsvMode ? 'CSV' : isFhirImport ? 'FHIR' : 'JSON';

  return (
    <div className="page-shell">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 28 }}>
        <div>
          <h1 className="page-title" style={{ margin: '0 0 6px' }}>Ingest data</h1>
          <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)' }}>
            Upload a batch: every record is normalised, checked against the active rules and turned into findings.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginRight: 4 }}>Supported formats</span>
          {['CSV', 'JSONL', 'JSON', 'FHIR'].map(f => (
            <span key={f} className="rule-chip">{f}</span>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ background: 'var(--status-fail-bg)', border: '1px solid var(--status-fail-border)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: 'var(--status-fail-ink)', fontSize: '0.8125rem' }}>
          <strong>Ingestion failed:</strong> {error}
        </div>
      )}

      {/* COMPLETE STATE */}
      {step === 'complete' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--status-pass-border)', borderRadius: 16, padding: '28px 32px', boxShadow: 'var(--card-shadow)', display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            <Sentinel state="pass" size={64} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 6 }}>Ingestion complete</div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 20 }}>{acceptedCount} claims processed · Backend evaluation complete</div>
              {ingestionResult?.authorization_warning && (
                <div style={{ background: 'var(--status-uta-bg)', border: '1px solid var(--status-uta-border)', borderRadius: 7, padding: '10px 12px', marginBottom: 16, color: 'var(--status-uta-ink)', fontSize: '0.8125rem' }}>
                  <strong>FHIR limitation:</strong> {ingestionResult.authorization_warning}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: 16, marginBottom: 20 }}>
                {[
                  { label: 'Accepted claims', value: String(acceptedCount), color: 'var(--accent)' },
                  { label: 'Rejected records', value: String(rejectedCount), color: 'var(--status-fail-ink)' },
                  { label: 'Require review', value: String(reviewCount), color: 'var(--status-review)' },
                ].map(s => (
                  <div key={s.label} style={{ background: 'var(--canvas-bg)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '12px 16px', textAlign: 'center' }}>
                    <div style={{ fontFamily: "var(--font-sans)", fontSize: '1.5rem', fontWeight: 700, color: s.color, letterSpacing: '-0.03em' }}>{s.value}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 3 }}>{s.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => onNavigate('claims')} className="btn btn-primary">
                  View claims
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7h9M8 4l3.5 3L8 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                <button onClick={() => onNavigate('runs')} className="btn btn-secondary">View runs</button>
                <button onClick={() => onNavigate('audit')} className="btn btn-secondary">View audit event</button>
                <button onClick={handleReset} className="btn btn-ghost">Ingest another file</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PROCESSING STATE */}
      {step === 'processing' && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 16, padding: '40px', boxShadow: 'var(--card-shadow)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
          <Sentinel state="scanning" size={80} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>Processing claims…</div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>{fileName} · {recordCount} records</div>
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
                    background: isActive ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'transparent',
                    border: isActive ? '1px solid color-mix(in srgb, var(--accent) 20%, transparent)' : '1px solid transparent',
                    transition: 'all 0.2s ease',
                  }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isDone ? 'var(--status-pass-bg)' : isActive ? 'var(--accent-subtle)' : 'var(--canvas-bg)', border: `1.5px solid ${isDone ? 'var(--status-pass)' : isActive ? 'var(--accent)' : 'var(--border)'}`, transition: 'all 0.2s ease' }}>
                      {isDone ? (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5 4.5-5" stroke="var(--status-pass-ink)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      ) : isActive ? (
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', animation: 'sentinel-pulse 1s ease-in-out infinite' }} />
                      ) : (
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--border-strong)' }} />
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: isDone ? 'var(--status-pass-ink)' : isActive ? 'var(--text-primary)' : 'var(--text-tertiary)', transition: 'color 0.2s ease' }}>{s.label}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 1 }}>{s.detail}</div>
                    </div>
                  </div>
                  {i < PROCESSING_STEPS.length - 1 && (
                    <div style={{ display: 'flex', justifyContent: 'center', paddingLeft: 23 }}>
                      <div style={{ width: 1, height: 10, background: isDone ? 'var(--status-pass-border)' : 'var(--border)' }} />
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
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 16, padding: '16px 20px', boxShadow: 'var(--card-shadow)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--status-pass-bg)', border: '1px solid var(--status-pass-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 2h8l4 4v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="var(--status-pass-ink)" strokeWidth="1.3" strokeLinejoin="round"/><path d="M11 2v4h4" stroke="var(--status-pass-ink)" strokeWidth="1.3"/></svg>
              </div>
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: "var(--font-sans)" }}>
                  {isCsvMode ? `${CSV_PACK_FILES.length} CSV files` : fileName}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                  {formatLabel}{fileSize ? ` · ${fileSize}` : ''} · {recordCount} records
                </div>
              </div>
            </div>
            <button onClick={handleReset} className="btn btn-ghost btn-sm">Remove</button>
          </div>

          {/* Validation result */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 2 }}>Ingestion validation</h3>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>Format validation complete. Review issues before processing.</p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {[
                  { label: `${acceptedCount} valid`, color: 'var(--status-pass-ink)', bg: 'var(--status-pass-bg)', border: 'var(--status-pass-border)' },
                  { label: `${rejectedCount} invalid`, color: 'var(--status-fail-ink)', bg: 'var(--status-fail-bg)', border: 'var(--status-fail-border)' },
                  { label: `${validationIssues.filter(i => i.severity === 'WARNING').length} warnings`, color: 'var(--status-uta-ink)', bg: 'var(--status-uta-bg)', border: 'var(--status-uta-border)' },
                ].map(s => (
                  <span key={s.label} style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: 6, padding: '4px 10px', fontSize: '0.75rem', fontWeight: 700, fontFamily: "var(--font-sans)" }}>{s.label}</span>
                ))}
              </div>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Issues requiring attention</div>
              <table className="data-table" style={{ marginBottom: 0 }}>
                <thead><tr><th>Row</th><th>Field</th><th>Issue</th><th>Severity</th></tr></thead>
                <tbody>
                  {validationIssues.map((issue, i) => (
                    <tr key={i}>
                      <td><span style={{ fontFamily: "var(--font-sans)", fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{issue.row}</span></td>
                      <td><span style={{ fontFamily: "var(--font-sans)", fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{issue.field}</span></td>
                      <td><span style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>{issue.issue}</span></td>
                      <td>
                        <span style={{ fontFamily: "var(--font-sans)", fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.06em', borderRadius: 4, padding: '2px 8px', background: issue.severity === 'ERROR' ? 'var(--status-fail-bg)' : 'var(--status-uta-bg)', color: issue.severity === 'ERROR' ? 'var(--status-fail-ink)' : 'var(--status-uta-ink)', border: `1px solid ${issue.severity === 'ERROR' ? 'var(--status-fail-border)' : 'var(--status-uta-border)'}` }}>
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
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 2 }}>Data preview</h3>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>Showing first 5 of {recordCount} records</p>
            </div>
            <table className="data-table">
              <thead><tr><th>Claim ID</th><th>Provider</th><th>Service code</th><th>Amount</th><th>Service date</th><th>Policy</th></tr></thead>
              <tbody>
                {previewRows.map(row => (
                  <tr key={row.id}>
                    <td><span style={{ fontFamily: "var(--font-sans)", fontSize: '0.8125rem', fontWeight: 700, color: 'var(--accent)' }}>{row.id}</span></td>
                    <td><span style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>{row.provider}</span></td>
                    <td><span style={{ fontFamily: "var(--font-sans)", fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{row.service}</span></td>
                    <td><span style={{ fontFamily: "var(--font-sans)", fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{row.amount}</span></td>
                    <td><span style={{ fontFamily: "var(--font-sans)", fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{row.dos}</span></td>
                    <td><span style={{ fontFamily: "var(--font-sans)", fontSize: '0.6875rem', fontWeight: 700, color: row.policy === 'EDU-BASIC' ? 'var(--accent)' : 'var(--status-review)', background: row.policy === 'EDU-BASIC' ? 'var(--accent-subtle)' : 'var(--status-review-bg)', border: `1px solid ${row.policy === 'EDU-BASIC' ? 'var(--status-pass-border)' : 'var(--status-review-border)'}`, borderRadius: 4, padding: '2px 7px' }}>{row.policy}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={handleReset} className="btn btn-secondary">Cancel</button>
            <button onClick={handleProcess} className="btn btn-primary">
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
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 16, padding: '20px 24px', boxShadow: 'var(--card-shadow)' }}>

            {isCsvMode ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>CSV claim pack</div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                      {Object.keys(csvFiles).length} of {CSV_PACK_FILES.length} required files attached
                    </div>
                  </div>
                  <button onClick={handleReset} className="btn btn-ghost btn-sm">Remove</button>
                </div>

                {/* Required CSV pack checklist */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: csvUnrecognized.length ? 10 : 0 }}>
                  {CSV_PACK_FILES.map((name) => {
                    const present = Boolean(csvFiles[name]);
                    return (
                      <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 18, height: 18, borderRadius: '50%', background: present ? 'var(--status-pass-bg)' : 'var(--status-uta-bg)', border: `1px solid ${present ? 'var(--status-pass-border)' : 'var(--status-uta-border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {present ? (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5 4-4" stroke="var(--status-pass-ink)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          ) : (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1l4 7H1L5 1z" stroke="var(--status-uta-ink)" strokeWidth="1"/><path d="M5 4v2M5 7.5v.3" stroke="var(--status-uta-ink)" strokeWidth="1" strokeLinecap="round"/></svg>
                          )}
                        </div>
                        <span style={{ fontFamily: "var(--font-sans)", fontSize: '0.8125rem', color: present ? 'var(--text-primary)' : 'var(--status-uta-ink)', fontWeight: present ? 400 : 500 }}>
                          {name} {present ? '' : '— missing'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {csvUnrecognized.length > 0 && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--status-fail-ink)', marginBottom: 10 }}>
                    Not recognized (expected one of {CSV_PACK_FILES.join(', ')}): {csvUnrecognized.join(', ')}
                  </div>
                )}
                {!csvReady && (
                  <>
                    <input
                      ref={addMoreInputRef}
                      type="file"
                      multiple
                      accept=".csv"
                      style={{ display: 'none' }}
                      onChange={(e) => selectFiles(e.target.files)}
                    />
                    <button
                      onClick={() => addMoreInputRef.current?.click()}
                      className="btn btn-secondary btn-sm"
                    >
                      + Add the missing CSV files
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 9, background: 'var(--canvas-bg)', border: '1px solid var(--card-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 3h8l5 5v9a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="var(--accent)" strokeWidth="1.3" strokeLinejoin="round"/><path d="M12 3v5h5" stroke="var(--accent)" strokeWidth="1.3"/></svg>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: "var(--font-sans)", marginBottom: 3 }}>{fileName}</div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontFamily: "var(--font-sans)", fontSize: '0.6875rem', fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-subtle)', border: '1px solid var(--status-pass-border)', borderRadius: 4, padding: '1px 7px' }}>{formatLabel}</span>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{fileSize}</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={handleReset} className="btn btn-ghost btn-sm">Remove</button>
                </div>
              </>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={handleReset} className="btn btn-secondary">Cancel</button>

            <button
              onClick={handleValidate}
              disabled={isCsvMode && !csvReady}
              className="btn btn-primary"
            >
              Validate & Preview →
            </button>
          </div>
        </div>
      )}

      {/* IDLE STATE */}
      {step === 'idle' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Source selector */}
          <div className="segmented" role="tablist" aria-label="Import source" style={{ width: 'fit-content' }}>
            {[
              { key: 'upload' as const, label: 'Upload file' },
              { key: 'paste' as const, label: 'Paste JSON' },
              { key: 'fhir' as const, label: 'FHIR resource' },
            ].map(s => (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={selectedFormat === s.key}
                onClick={() => setSelectedFormat(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>

          {selectedFormat === 'upload' ? (
            <>
              {/* Drop zone */}
              <div
                onDragEnter={() => setDragging(true)}
                onDragLeave={() => setDragging(false)}
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`dropzone${dragging ? ' is-dragging' : ''}`}
              >
                <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} accept=".csv,.json,.jsonl" onChange={e => selectFiles(e.target.files)} />
                <div className="dropzone-icon" aria-hidden="true">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M12 16V5M7.5 9.5L12 5l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M5 19h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                </div>
                <div>
                  <div className="dropzone-title">Drop your claim file(s) here</div>
                  <div className="dropzone-caption">A JSON/JSONL claim or FHIR Bundle file, or all five .csv pack files at once</div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  >
                    Browse files
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Supported</span>
                  {['.csv', '.json', '.jsonl'].map(f => <span key={f} className="rule-chip">{f}</span>)}
                </div>
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                CSV uploads require all five pack files selected together: <span className="mono-id" style={{ fontWeight: 500, whiteSpace: 'normal' }}>{CSV_PACK_FILES.join(', ')}</span>.
              </div>

              {/* Format cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                {FORMAT_CARDS.map(fc => (
                  <div key={fc.label} className="format-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <span className="format-card-title">{fc.label}</span>
                      <span className="rule-chip">{fc.ext}</span>
                    </div>
                    <div className="format-card-desc">{fc.desc}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 16, padding: '20px 24px', boxShadow: 'var(--card-shadow)' }}>
              <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                {selectedFormat === 'fhir' ? 'Paste a FHIR Bundle (JSON)' : 'Paste JSON, a JSON array, or JSONL'}
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
                {selectedFormat === 'fhir'
                  ? 'One FHIR Bundle per line (JSONL), or a single Bundle / array of Bundles.'
                  : 'One normalized claim per line (JSONL), or a single claim / array of claims.'}
              </div>
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                placeholder={selectedFormat === 'fhir' ? '{ "resourceType": "Bundle", ... }' : '{ "claim_id": "...", ... }'}
                rows={12}
                style={{
                  width: '100%',
                  background: 'var(--canvas-bg)',
                  border: '1px solid var(--card-border)',
                  borderRadius: 8,
                  padding: '12px 14px',
                  fontSize: '0.8125rem',
                  fontFamily: "var(--font-mono)",
                  color: 'var(--text-primary)',
                  outline: 'none',
                  resize: 'vertical',
                  marginBottom: 14,
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={usePastedText}
                  disabled={!pasteText.trim()}
                  className="btn btn-primary"
                >
                  Use this input →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
