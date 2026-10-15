import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { adminHeaders, getAdminActor, getAdminToken, setAdminActor, setAdminToken } from "../api/admin";
import { apiFetch } from "../api/client";
import RuleManager from "../components/RuleManager";
import "../styles/admin.css";

const ICON_PATHS: Record<string, React.ReactNode> = {
  "rules.json": (
    <>
      <path d="M4 6.5h16M4 12h10M4 17.5h7" />
      <circle cx="19" cy="17" r="3.2" />
      <path d="m21.4 19.4 2 2" />
    </>
  ),
  "policies.json": (
    <>
      <path d="M12 2.8 4.5 6v6.1c0 4.3 3.1 8.3 7.5 9.4 4.4-1.1 7.5-5.1 7.5-9.4V6z" />
      <path d="m8.8 12 2.3 2.3 4.1-4.4" />
    </>
  ),
  "diagnoses.json": (
    <>
      <path d="M4 20V9.5M9.3 20V4.5M14.7 20v-7M20 20v-10.5" />
      <path d="M2.5 20h19" />
    </>
  ),
  "providers.json": (
    <>
      <rect x="3" y="6.5" width="18" height="14" rx="2.2" />
      <path d="M8.5 6.5V4.6A1.6 1.6 0 0 1 10.1 3h3.8a1.6 1.6 0 0 1 1.6 1.6v1.9" />
      <path d="M12 10.6v5.6M9.2 13.4h5.6" />
    </>
  ),
  "services.json": (
    <>
      <rect x="2.6" y="8.6" width="18.8" height="6.8" rx="3.4" />
      <path d="M8.6 8.6V6.4a3.4 3.4 0 0 1 6.8 0v2.2M17.4 10.2h4" />
    </>
  ),
};

const FILES = [
  { id: "rules.json", label: "Rules" },
  { id: "policies.json", label: "Policies" },
  { id: "diagnoses.json", label: "Diagnosis codes" },
  { id: "providers.json", label: "Providers" },
  { id: "services.json", label: "Services" },
];

const API = "/api/v1/config";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="ad-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <input value={value ?? ""} onChange={e => onChange(e.target.value)} />
    </Field>
  );
}

function Textarea({ label, value, onChange, rows = 4 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <Field label={label}>
      <textarea rows={rows} value={value ?? ""} onChange={e => onChange(e.target.value)} />
    </Field>
  );
}

/**
 * Numeric field that tolerates the way people actually type numbers.
 *
 * `type="number"` silently swallows anything that is not parseable, so a stray
 * comma (or a pasted "1,250") makes the field go blank or truncate to the
 * digits after it — "12,5" typed in became "5". Keeping the element a *text*
 * input and parsing on change means every keystroke is visible and the value
 * survives being typed or pasted with separators.
 */
/**
 * Parse a number the way people actually type one.
 *
 * Handles thousands separators ("1,250") and a comma used as the decimal mark
 * ("350,75"), which is common on this data (SAR). A lone comma is always a
 * separator, not a decimal point, so it is stripped first; a comma that sits
 * between digits with exactly one group to its right and no dot anywhere is
 * treated as the decimal mark instead.
 */
function parseNumeric(raw: string): number {
  let text = raw.trim().replace(/[\s_]/g, "");
  if (text === "") return NaN;

  const hasDot = text.includes(".");
  const commas = (text.match(/,/g) || []).length;

  if (!hasDot && commas === 1) {
    // "350,75" -> decimal mark; "1,250" / "1,2,3" -> grouping.
    const [, after] = text.split(",");
    const looksLikeGrouping = after.length === 3 && /^\d+$/.test(after) && !/^0\d/.test(after);
    if (!looksLikeGrouping) text = text.replace(",", ".");
    else text = text.replace(/,/g, "");
  } else {
    text = text.replace(/,/g, "");
  }

  text = text.replace(/[^0-9.\-]/g, "");
  if (text === "" || text === "-" || text === "." || text === "-.") return NaN;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * The bare numeric control used inside key/value maps, where there is no
 * Field label wrapper. Same comma tolerance as NumberInput.
 */
function NumericValueInput({ value, onChange, placeholder }: { value: number; onChange: (v: number) => void; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (Number.isFinite(value) ? String(value) : "");
  return (
    <input
      type="text"
      inputMode="decimal"
      className="ad-num"
      aria-label={placeholder ?? "Value"}
      value={shown}
      placeholder={placeholder ?? "0"}
      onChange={e => {
        const raw = e.target.value;
        setDraft(raw);
        const parsed = parseNumeric(raw);
        onChange(Number.isNaN(parsed) ? 0 : parsed);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

function NumberInput({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  // Keep the raw text while the field is focused so intermediate states
  // ("", "-", "1.") are not yanked out from under the cursor.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (Number.isFinite(value) ? String(value) : "");

  const commit = (raw: string) => {
    setDraft(raw);
    const parsed = parseNumeric(raw);
    onChange(Number.isNaN(parsed) ? 0 : parsed);
  };

  return (
    <Field label={label}>
      <input
        type="text"
        inputMode="decimal"
        // Hint to the spinner/number-pad without the browser rejecting input.
        data-step={step ?? 1}
        className="ad-num"
        value={shown}
        placeholder="0"
        onChange={e => commit(e.target.value)}
        onBlur={() => setDraft(null)}
      />
    </Field>
  );
}

/**
 * Comma-separated list field.
 *
 * The value round-trips through `string[]`, so splitting on every keystroke
 * and re-joining for display deleted the comma the user had *just* typed:
 * typing a trailing comma produced an empty trailing segment, filter(Boolean)
 * dropped it, and the re-rendered text no longer contained the comma — so it
 * was impossible to start a new entry. Keeping a local draft for as long as
 * the field is focused means the text is what the user typed; the array is
 * only recomputed on blur (and for every keystroke too, so the parent state
 * stays live for validation).
 */
function ListInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  hint?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value ?? []).join(", ");

  const handleChange = (raw: string) => {
    setDraft(raw);
    // Trim each segment but keep empties out of the stored array.
    onChange(raw.split(",").map(segment => segment.trim()).filter(Boolean));
  };

  return (
    <Field label={label + " (comma-separated)"}>
      <input
        value={shown}
        placeholder={hint ?? "EDU-PROV-01, EDU-PROV-02"}
        onChange={e => handleChange(e.target.value)}
        onBlur={() => setDraft(null)}
        spellCheck={false}
        autoComplete="off"
      />
    </Field>
  );
}

function KVMapInput({ label, value, onChange, valueType = "text", keyHint = "SVC-LAB", valueHint }: {
  label: string;
  value: Record<string, any>;
  onChange: (v: Record<string, any>) => void;
  valueType?: "text" | "number";
  keyHint?: string;
  valueHint?: string;
}) {
  const entries = Object.entries(value ?? {});
  const listRef = useRef<HTMLDivElement>(null);
  const [focusLast, setFocusLast] = useState(false);
  useEffect(() => {
    if (!focusLast) return;
    setFocusLast(false);
    const inputs = listRef.current?.querySelectorAll<HTMLInputElement>(".ad-kv-key");
    inputs?.[inputs.length - 1]?.focus();
  }, [focusLast, entries.length]);

  const update = (idx: number, newKey: string, newVal: any) => {
    const next: Record<string, any> = {};
    entries.forEach(([k, v], i) => {
      const key = i === idx ? newKey : k;
      const val = i === idx ? newVal : v;
      next[key] = val;
    });
    onChange(next);
  };
  const add = () => {
    onChange({ ...value, "": valueType === "number" ? 0 : "" });
    setFocusLast(true);
  };
  const remove = (idx: number) => {
    const next: Record<string, any> = {};
    entries.forEach(([k, v], i) => { if (i !== idx) next[k] = v; });
    onChange(next);
  };
  return (
    <fieldset className="ad-kv">
      <legend>{label}</legend>
      <div ref={listRef}>
        {entries.length === 0 && <p className="ad-muted">No entries yet.</p>}
        {entries.map(([k, v], idx) => (
          <div key={idx} className="ad-kv-row">
            <input className="ad-kv-key" aria-label={`${label}: key ${idx + 1}`} placeholder={keyHint} value={k} spellCheck={false} onChange={e => update(idx, e.target.value, v)} />
            {valueType === "number" ? (
              // Same comma-tolerant numeric field as the standalone prices.
              <NumericValueInput value={typeof v === "number" ? v : Number(v)} onChange={n => update(idx, k, n)} placeholder={valueHint} />
            ) : (
              <input aria-label={`${label}: value ${idx + 1}`} placeholder={valueHint ?? "Value"} value={v ?? ""} onChange={e => update(idx, k, e.target.value)} />
            )}
            <button type="button" className="ad-btn is-icon" onClick={() => remove(idx)} aria-label={`Remove ${k || "row"}`} title="Remove">×</button>
          </div>
        ))}
      </div>
      <button type="button" className="ad-link" onClick={add}>Add a row</button>
    </fieldset>
  );
}

/**
 * Admin access for this browser tab. Changes to rules and reference data
 * take effect immediately, so the server requires its admin token for them.
 */
function AdminAccessBar() {
  const [token, setToken] = useState(getAdminToken());
  const [actor, setActor] = useState(getAdminActor());
  const [editing, setEditing] = useState(!getAdminToken());
  if (!editing) {
    return (
      <div className="ad-access is-set">
        <span>Admin access set for this tab{actor ? <> as <strong>{actor}</strong></> : ""}.</span>
        <button type="button" className="ad-link" onClick={() => setEditing(true)}>Change</button>
      </div>
    );
  }
  return (
    <form className="ad-access" onSubmit={e => { e.preventDefault(); if (token) setEditing(false); }}>
      <label className="ad-field">
        <span>Admin token</span>
        <input id="admin-token" type="password" value={token} autoComplete="off"
          onChange={e => { setToken(e.target.value); setAdminToken(e.target.value); }} />
      </label>
      <label className="ad-field">
        <span>Your name, for the audit log</span>
        <input id="admin-actor" value={actor} onChange={e => { setActor(e.target.value); setAdminActor(e.target.value); }} />
      </label>
      <button type="submit" className="ad-btn" disabled={!token}>Done</button>
      <p className="ad-muted">Kept for this tab only. Needed to save changes and to draft, confirm or deactivate rules.</p>
    </form>
  );
}

function PolicyForm({ item, onChange }: { item: any; onChange: (f: string, v: any) => void }) {
  return (
    <>
      <div className="ad-form-grid">
        <TextInput label="Policy ID" value={item.policy_id} onChange={v => onChange("policy_id", v)} />
        <TextInput label="Payer ID" value={item.payer_id} onChange={v => onChange("payer_id", v)} />
        <TextInput label="Currency" value={item.currency} onChange={v => onChange("currency", v)} />
        <TextInput label="Version" value={item.version} onChange={v => onChange("version", v)} />
      </div>
      <NumberInput label="Submission window (days)" value={item.submission_window_days} onChange={v => onChange("submission_window_days", v)} />
      <ListInput label="Allowed providers" value={item.allowed_providers ?? []} onChange={v => onChange("allowed_providers", v)} />
      <ListInput label="Services that need authorization" value={item.auth_required_services ?? []} onChange={v => onChange("auth_required_services", v)} hint="SVC-IMAGE, SVC-SURGERY" />
      <KVMapInput label="Required documents (service code → document type)" value={item.required_documents ?? {}} onChange={v => onChange("required_documents", v)} valueType="text" valueHint="Document type" />
      <KVMapInput label="Max unit price (service code → SAR)" value={item.max_unit_price ?? {}} onChange={v => onChange("max_unit_price", v)} valueType="number" valueHint="SAR" />
      <KVMapInput label="Max quantity per line (service code → quantity)" value={item.max_quantity_per_line ?? {}} onChange={v => onChange("max_quantity_per_line", v)} valueType="number" valueHint="Quantity" />
    </>
  );
}

function DiagnosisForm({ item, onChange }: { item: any; onChange: (f: string, v: any) => void }) {
  return (
    <>
      <TextInput label="Diagnosis code" value={item.code} onChange={v => onChange("code", v)} />
      <Textarea label="Description" value={item.display} onChange={v => onChange("display", v)} rows={3} />
    </>
  );
}

function ProviderForm({ item, onChange }: { item: any; onChange: (f: string, v: any) => void }) {
  return (
    <>
      <TextInput label="Provider ID / NPI" value={item.provider_id} onChange={v => onChange("provider_id", v)} />
      <TextInput label="Display name" value={item.display} onChange={v => onChange("display", v)} />
    </>
  );
}

function ServiceForm({ item, onChange }: { item: any; onChange: (f: string, v: any) => void }) {
  return (
    <>
      <TextInput label="Service code" value={item._key} onChange={v => onChange("_key", v)} />
      <TextInput label="Description" value={item.description} onChange={v => onChange("description", v)} />
      <div className="ad-form-grid is-3">
        <NumberInput label="Base price (SAR)" value={item.base_price} onChange={v => onChange("base_price", v)} step={0.01} />
        <NumberInput label="Max price (SAR)" value={item.max_price} onChange={v => onChange("max_price", v)} step={0.01} />
        <NumberInput label="Max quantity" value={item.max_quantity} onChange={v => onChange("max_quantity", v)} />
      </div>
    </>
  );
}

function blankItem(file: string): any {
  switch (file) {
    case "policies.json": return { policy_id: "NEW-POLICY", version: "1.0.0", payer_id: "", currency: "SAR", submission_window_days: 30, allowed_providers: [], auth_required_services: [], required_documents: {}, max_unit_price: {}, max_quantity_per_line: {} };
    case "diagnoses.json": return { code: "DX-NEW", display: "" };
    case "providers.json": return { provider_id: "NEW-PROV", display: "" };
    case "services.json": return { _key: "SVC-NEW", description: "", base_price: 0, max_price: 0, max_quantity: 1 };
    default: return {};
  }
}

export default function AdminPanel() {
  const [activeFile, setActiveFile] = useState("rules.json");
  const [data, setData] = useState<any[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string; leaving?: boolean } | null>(null);
  const toastTimers = useRef<number[]>([]);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [revealSelected, setRevealSelected] = useState(false);

  const showToast = (type: "success" | "error", msg: string) => {
    // A new toast replaces the current one and restarts its timers (an older timer
    // must not cut the new message short). It slides out the way it came in.
    toastTimers.current.forEach(window.clearTimeout);
    setToast({ type, msg });
    toastTimers.current = [
      window.setTimeout(() => setToast(current => (current ? { ...current, leaving: true } : current)), 3300),
      window.setTimeout(() => setToast(null), 3500),
    ];
  };

  const managesRules = activeFile === "rules.json";

  const loadData = useCallback(() => {
    if (activeFile === "rules.json") return; // rules have their own manager
    setData(null);
    apiFetch<any>(`${API}/${activeFile}`)
      .then(json => {
        let arr: any[] = [];
        if (Array.isArray(json)) {
          arr = json;
        } else {
          arr = Object.entries(json).map(([k, v]: any) => ({ ...v, _key: k }));
        }
        setData(arr);
        setSelectedIndex(arr.length > 0 ? 0 : null);
        setDirty(false);
      })
      .catch(e => { setData([]); showToast("error", e.message); });
  }, [activeFile]);

  useEffect(() => { loadData(); setQuery(""); }, [loadData]);

  // Leaving with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // After adding (or picking) an entry, bring it into view in the list and put the cursor in its first field.
  useEffect(() => {
    if (!revealSelected) return;
    setRevealSelected(false);
    listRef.current?.querySelector<HTMLElement>("[aria-current='true']")?.scrollIntoView({ block: "nearest" });
    editorRef.current?.scrollTo({ top: 0 });
    editorRef.current?.querySelector<HTMLInputElement>("input, textarea")?.focus({ preventScroll: true });
  }, [revealSelected]);

  const items = data ?? [];

  const buildPayload = () => {
    if (activeFile === "services.json") {
      const obj: Record<string, any> = {};
      items.forEach(({ _key, ...rest }) => { if (_key) obj[_key] = rest; });
      return obj;
    }
    if (activeFile === "policies.json") {
      const obj: Record<string, any> = {};
      items.forEach(item => { if (item.policy_id) obj[item.policy_id] = item; });
      return obj;
    }
    return items;
  };

  const handleSave = () => {
    setSaving(true);
    apiFetch<{ status: string; message: string }>(`${API}/${activeFile}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify(buildPayload()),
    })
      .then(response => { showToast("success", response.message || "Saved"); setDirty(false); })
      .catch(e => showToast("error", e.message))
      .finally(() => setSaving(false));
  };

  const handleDiscard = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    loadData();
  };

  const updateField = (field: string, value: any) => {
    if (selectedIndex === null) return;
    const next = [...items];
    next[selectedIndex] = { ...next[selectedIndex], [field]: value };
    setData(next);
    setDirty(true);
  };

  const addItem = () => {
    const next = [...items, blankItem(activeFile)];
    setData(next);
    setQuery("");
    setSelectedIndex(next.length - 1);
    setDirty(true);
    setRevealSelected(true);
  };

  const removeItem = () => {
    if (selectedIndex === null) return;
    if (!window.confirm(`Delete ${labelOf(items[selectedIndex])}? It is removed when you save.`)) return;
    const next = items.filter((_, i) => i !== selectedIndex);
    setData(next);
    setSelectedIndex(next.length > 0 ? Math.min(selectedIndex, next.length - 1) : null);
    setDirty(true);
  };

  const labelOf = (item: any) =>
    item.rule_id || item.policy_id || item.code || item.provider_id || item._key || "Untitled";
  const subOf = (item: any) => item.display || item.description || item.payer_id || "";

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !needle || `${labelOf(item)} ${subOf(item)}`.toLowerCase().includes(needle));
  }, [items, query]);

  const selectedItem = selectedIndex !== null ? items[selectedIndex] : null;
  const fileLabel = FILES.find(f => f.id === activeFile)?.label ?? activeFile;

  const renderForm = () => {
    if (!selectedItem) return null;
    switch (activeFile) {
      case "policies.json":  return <PolicyForm    item={selectedItem} onChange={updateField} />;
      case "diagnoses.json": return <DiagnosisForm item={selectedItem} onChange={updateField} />;
      case "providers.json": return <ProviderForm  item={selectedItem} onChange={updateField} />;
      case "services.json":  return <ServiceForm   item={selectedItem} onChange={updateField} />;
      default: return null;
    }
  };

  return (
    <div className="page-shell ad-page">
      {toast && (
        <div className={`ad-toast is-${toast.type}${toast.leaving ? " is-leaving" : ""}`} role={toast.type === "error" ? "alert" : "status"}>{toast.msg}</div>
      )}

      <header className="ad-head">
        <div>
          <h1>Admin</h1>
          <p>Rules are written in plain English and checked before they run. Reference data is used by the rules.</p>
        </div>
      </header>

      <AdminAccessBar />

      <nav className="ad-tabs" aria-label="What to manage">
        {FILES.map(f => (
          <button
            key={f.id}
            type="button"
            className="ad-tab"
            aria-pressed={activeFile === f.id}
            onClick={() => {
              if (f.id === activeFile) return;
              if (dirty && !window.confirm("Switch? Unsaved changes will be lost.")) return;
              setActiveFile(f.id);
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {ICON_PATHS[f.id]}
            </svg>
            {f.label}
          </button>
        ))}
      </nav>

      {managesRules ? <RuleManager /> : (
        <div className="ad-workspace">
          <aside className="ad-list" aria-label={fileLabel}>
            <div className="ad-list-head">
              <span>{fileLabel} {data ? `(${items.length})` : ""}</span>
              <button type="button" className="ad-btn is-primary is-small" onClick={addItem} disabled={!data}>Add</button>
            </div>
            <label className="ad-search">
              <span className="visually-hidden">Find an entry</span>
              <input type="search" placeholder="Find by code or name" value={query} onChange={e => setQuery(e.target.value)} />
            </label>
            <div className="ad-list-body" ref={listRef}>
              {!data ? (
                <p className="ad-muted">Loading…</p>
              ) : shown.length === 0 ? (
                <p className="ad-muted">{query ? "Nothing matches." : "No entries yet."}</p>
              ) : shown.map(({ item, index }) => (
                <button
                  key={index}
                  type="button"
                  className="ad-item"
                  aria-current={selectedIndex === index || undefined}
                  onClick={() => setSelectedIndex(index)}
                >
                  <span className="ad-mono">{labelOf(item)}</span>
                  {subOf(item) && <span className="ad-item-sub">{subOf(item)}</span>}
                </button>
              ))}
            </div>
          </aside>

          <div className="ad-editor is-form">
            {selectedItem ? (
              <>
                <header className="ad-editor-head is-pinned">
                  <div>
                    <h2 className="ad-mono">{labelOf(selectedItem)}</h2>
                    <p className="ad-meta">{fileLabel} · entry {(selectedIndex ?? 0) + 1} of {items.length}</p>
                  </div>
                  <button type="button" className="ad-btn is-danger" onClick={removeItem}>Delete</button>
                </header>
                <div className="ad-editor-body" ref={editorRef}>
                  {renderForm()}
                </div>
              </>
            ) : (
              <div className="ad-blank" ref={editorRef}>
                <p>{data ? "Select an entry to edit, or add a new one." : "Loading…"}</p>
              </div>
            )}
            <footer className="ad-bar is-footer">
              <span className={dirty ? "ad-text-review" : "ad-muted"}>{dirty ? "Unsaved changes" : "All changes saved"}</span>
              <button type="button" className="ad-btn" onClick={handleDiscard} disabled={!dirty}>Discard</button>
              <button type="button" className="ad-btn is-primary" onClick={handleSave} disabled={saving || !dirty}>
                {saving ? "Saving…" : "Save"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
