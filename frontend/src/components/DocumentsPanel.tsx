import { useEffect, useRef, useState } from 'react';
import type { BackendClaim } from '../api/claims';
import {
  MAX_UPLOAD_BYTES,
  clearEvidenceCache,
  deleteDocument,
  listDocuments,
  uploadDocument,
  type EvidenceDocument,
} from '../api/evidence';
import '../styles/evidence.css';

// ── Documents ──────────────────────────────────────────────────────────────
// PDFs attached to this claim for evidence retrieval. They are searched only
// when a reviewer opens a finding, and never change a rule result.

const UNLINKED = 'UNLINKED';

const METHOD_LABEL: Record<EvidenceDocument['method'], string> = {
  text: 'text layer',
  ocr: 'OCR',
  mixed: 'text + OCR',
  none: 'no readable text',
};

function attachmentIds(claim: BackendClaim): string[] {
  const attachments = Array.isArray(claim.attachments) ? claim.attachments : [];
  return attachments
    .map((item) => (item && typeof item === 'object' ? (item as { attachment_id?: unknown }).attachment_id : null))
    .filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9._:-]+$/.test(id));
}

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function DocumentsPanel({ claim, onChanged }: { claim: BackendClaim; onChanged: () => void }) {
  const ids = attachmentIds(claim);
  const [documents, setDocuments] = useState<EvidenceDocument[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [linkTo, setLinkTo] = useState(ids[0] ?? UNLINKED);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const refresh = (signal?: AbortSignal) =>
    listDocuments(claim.claim_id, signal)
      .then((response) => {
        setDocuments(response.documents);
        setFailed(false);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setFailed(true);
      });

  useEffect(() => {
    const controller = new AbortController();
    setDocuments(null);
    refresh(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim.claim_id]);

  const changed = () => {
    clearEvidenceCache(claim.claim_id);
    onChanged();
  };

  const upload = async (file: File) => {
    setMessage(null);
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setMessage({ tone: 'error', text: 'Only PDF files can be attached.' });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setMessage({ tone: 'error', text: `${file.name} is ${size(file.size)}. The limit is 3 MB.` });
      return;
    }
    setBusy(true);
    try {
      const saved = await uploadDocument(claim.claim_id, linkTo, file);
      setMessage({
        tone: 'ok',
        text: saved.created ? `${saved.filename} added.` : `${saved.filename} was already attached.`,
      });
      await refresh();
      changed();
    } catch (cause) {
      setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : 'The document could not be added.' });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async (document: EvidenceDocument) => {
    setMessage(null);
    setBusy(true);
    try {
      await deleteDocument(claim.claim_id, document.document_id);
      setMessage({ tone: 'ok', text: `${document.filename} removed.` });
      await refresh();
      changed();
    } catch {
      setMessage({ tone: 'error', text: 'The document could not be removed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="documents-panel" aria-labelledby="documents-heading">
      <div className="documents-heading">
        <h2 id="documents-heading">Documents</h2>
        <span>{documents ? `${documents.length} attached` : ''}</span>
      </div>

      {failed ? (
        <p className="inspector-muted">Attached documents could not be listed.</p>
      ) : documents === null ? (
        <p className="inspector-muted" role="status">Loading documents…</p>
      ) : documents.length === 0 ? (
        <p className="inspector-muted">No PDFs attached. Attached PDFs are searched when you open a finding.</p>
      ) : (
        <ul className="documents-list">
          {documents.map((document) => (
            <li key={document.document_id}>
              <span className="documents-name">{document.filename}</span>
              <span className="documents-meta">
                <span className="mono">{document.attachment_id}</span> · {document.page_count} page{document.page_count === 1 ? '' : 's'} · {METHOD_LABEL[document.method]}
                {document.warnings.includes('ocr_unavailable') && ' · OCR unavailable'}
              </span>
              <button type="button" className="text-link" disabled={busy} onClick={() => remove(document)}>
                Remove<span className="visually-hidden"> {document.filename}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="documents-upload">
        <label>
          <span>Link to</span>
          <select value={linkTo} onChange={(event) => setLinkTo(event.target.value)} disabled={busy}>
            {ids.map((id) => <option key={id} value={id}>{id}</option>)}
            <option value={UNLINKED}>Not linked to an attachment</option>
          </select>
        </label>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          className="visually-hidden"
          id={`upload-${claim.claim_id}`}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <button type="button" className="button-secondary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Working…' : 'Attach PDF'}
        </button>
      </div>
      {message && (
        <p className={message.tone === 'error' ? 'inspector-error' : 'inspector-muted'} role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </section>
  );
}
