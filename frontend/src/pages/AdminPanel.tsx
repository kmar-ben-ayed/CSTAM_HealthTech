import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api/client";

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
  { id: "rules.json", label: "Validation Rules" },
  { id: "policies.json", label: "Policies" },
  { id: "diagnoses.json", label: "Diagnoses Codes" },
  { id: "providers.json", label: "Providers" },
  { id: "services.json", label: "Services" },
];

const API = "/api/v1/config";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "9px 13px",
  borderRadius: 8,
  border: "1px solid var(--card-border)",
  background: "var(--canvas-bg)",
  color: "var(--text-primary)",
  fontSize: "0.875rem",
  fontFamily: "inherit",
  boxSizing: "border-box",
};
const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontSize: "0.72rem",
  fontWeight: 600,
  color: "var(--text-secondary)",
  marginBottom: 5,
  textTransform: "uppercase",
  letterSpacing: "0.055em",
};
const FIELD_WRAP: React.CSSProperties = { marginBottom: 14 };
const SECTION_HDR: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 700,
  color: "var(--text-tertiary)",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  marginTop: 22,
  marginBottom: 10,
  paddingBottom: 6,
  borderBottom: "1px solid var(--card-border)",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={FIELD_WRAP}>
      <label style={LABEL_STYLE}>{label}</label>
      {children}
    </div>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <input style={INPUT_STYLE} value={value ?? ""} onChange={e => onChange(e.target.value)} />
    </Field>
  );
}

function Textarea({ label, value, onChange, rows = 4 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <Field label={label}>
      <textarea style={{ ...INPUT_STYLE, minHeight: rows * 22, resize: "vertical" }} value={value ?? ""} onChange={e => onChange(e.target.value)} />
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
      style={{ ...INPUT_STYLE, fontSize: "0.8125rem", fontVariantNumeric: "tabular-nums" }}
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
        style={{ ...INPUT_STYLE, fontVariantNumeric: "tabular-nums" }}
        value={shown}
        placeholder="0"
        onChange={e => commit(e.target.value)}
        onBlur={() => setDraft(null)}
      />
    </Field>
  );
}

function SelectInput({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <select style={{ ...INPUT_STYLE, cursor: "pointer" }} value={value ?? ""} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
      </select>
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
        style={INPUT_STYLE}
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

function KVMapInput({ label, value, onChange, valueType = "text" }: {
  label: string;
  value: Record<string, any>;
  onChange: (v: Record<string, any>) => void;
  valueType?: "text" | "number";
}) {
  const entries = Object.entries(value ?? {});
  const update = (idx: number, newKey: string, newVal: any) => {
    const next: Record<string, any> = {};
    entries.forEach(([k, v], i) => {
      const key = i === idx ? newKey : k;
      const val = i === idx ? newVal : v;
      next[key] = val;
    });
    onChange(next);
  };
  const add = () => onChange({ ...value, "": valueType === "number" ? 0 : "" });
  const remove = (idx: number) => {
    const next: Record<string, any> = {};
    entries.forEach(([k, v], i) => { if (i !== idx) next[k] = v; });
    onChange(next);
  };
  return (
    <div style={FIELD_WRAP}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        {label && <label style={LABEL_STYLE}>{label}</label>}
        <button onClick={add} style={{ background: "transparent", border: "1px solid var(--card-border)", borderRadius: 5, padding: "2px 8px", fontSize: "0.72rem", fontWeight: 700, color: "var(--text-primary)", cursor: "pointer" }}>+ Row</button>
      </div>
      {entries.length === 0 && <div style={{ fontSize: "0.8rem", color: "var(--text-tertiary)", fontStyle: "italic" }}>No entries. Click + Row to add.</div>}
      {entries.map(([k, v], idx) => (
        <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginBottom: 6, alignItems: "start" }}>
          <input placeholder="Key (e.g. SVC-LAB)" style={{ ...INPUT_STYLE, fontSize: "0.8125rem" }} value={k} spellCheck={false} onChange={e => update(idx, e.target.value, v)} />
          {valueType === "number" ? (
            // Same comma-tolerant numeric field as the standalone prices.
            <NumericValueInput value={typeof v === "number" ? v : Number(v)} onChange={n => update(idx, k, n)} />
          ) : (
            <input placeholder="Value" style={{ ...INPUT_STYLE, fontSize: "0.8125rem" }} value={v ?? ""} onChange={e => update(idx, k, e.target.value)} />
          )}
          <button onClick={() => remove(idx)} title="Remove row" style={{ background: "var(--status-fail-bg)", border: "1px solid var(--status-fail-border)", borderRadius: 6, width: 30, height: 36, cursor: "pointer", color: "var(--status-fail-ink)", fontSize: "1rem", fontWeight: 700 }}>x</button>
        </div>
      ))}
    </div>
  );
}

function RuleForm({ item, onChange }: { item: any; onChange: (f: string, v: any) => void }) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <TextInput label="Rule ID" value={item.rule_id} onChange={v => onChange("rule_id", v)} />
        <TextInput label="Version" value={item.version} onChange={v => onChange("version", v)} />
      </div>
      <TextInput label="Title" value={item.title} onChange={v => onChange("title", v)} />
      <SelectInput label="Severity" value={item.severity} options={["low", "medium", "high"]} onChange={v => onChange("severity", v)} />
      <TextInput label="Source Reference" value={item.source} onChange={v => onChange("source", v)} />
      <Textarea label="Logic / Condition" value={item.logic} onChange={v => onChange("logic", v)} rows={5} />
      <Textarea label="Corrective Action" value={item.corrective_action} onChange={v => onChange("corrective_action", v)} rows={3} />
    </>
  );
}

function PolicyForm({ item, onChange }: { item: any; onChange: (f: string, v: any) => void }) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <TextInput label="Policy ID" value={item.policy_id} onChange={v => onChange("policy_id", v)} />
        <TextInput label="Payer ID" value={item.payer_id} onChange={v => onChange("payer_id", v)} />
        <TextInput label="Currency" value={item.currency} onChange={v => onChange("currency", v)} />
        <TextInput label="Version" value={item.version} onChange={v => onChange("version", v)} />
      </div>
      <NumberInput label="Submission Window (Days)" value={item.submission_window_days} onChange={v => onChange("submission_window_days", v)} />
      <ListInput label="Allowed Providers" value={item.allowed_providers ?? []} onChange={v => onChange("allowed_providers", v)} />
      <ListInput label="Auth-Required Services" value={item.auth_required_services ?? []} onChange={v => onChange("auth_required_services", v)} />
      <div style={SECTION_HDR}>Required Documents (service code to document type)</div>
      <KVMapInput label="" value={item.required_documents ?? {}} onChange={v => onChange("required_documents", v)} valueType="text" />
      <div style={SECTION_HDR}>Max Unit Price (service code to SAR)</div>
      <KVMapInput label="" value={item.max_unit_price ?? {}} onChange={v => onChange("max_unit_price", v)} valueType="number" />
      <div style={SECTION_HDR}>Max Quantity Per Line (service code to qty)</div>
      <KVMapInput label="" value={item.max_quantity_per_line ?? {}} onChange={v => onChange("max_quantity_per_line", v)} valueType="number" />
    </>
  );
}

function DiagnosisForm({ item, onChange }: { item: any; onChange: (f: string, v: any) => void }) {
  return (
    <>
      <TextInput label="Diagnosis Code" value={item.code} onChange={v => onChange("code", v)} />
      <Textarea label="Display Description" value={item.display} onChange={v => onChange("display", v)} rows={3} />
    </>
  );
}

function ProviderForm({ item, onChange }: { item: any; onChange: (f: string, v: any) => void }) {
  return (
    <>
      <TextInput label="Provider ID / NPI" value={item.provider_id} onChange={v => onChange("provider_id", v)} />
      <TextInput label="Display Name" value={item.display} onChange={v => onChange("display", v)} />
    </>
  );
}

function ServiceForm({ item, onChange }: { item: any; onChange: (f: string, v: any) => void }) {
  return (
    <>
      <TextInput label="Service Code (Key)" value={item._key} onChange={v => onChange("_key", v)} />
      <TextInput label="Description" value={item.description} onChange={v => onChange("description", v)} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        <NumberInput label="Base Price (SAR)" value={item.base_price} onChange={v => onChange("base_price", v)} step={0.01} />
        <NumberInput label="Max Price (SAR)" value={item.max_price} onChange={v => onChange("max_price", v)} step={0.01} />
        <NumberInput label="Max Quantity" value={item.max_quantity} onChange={v => onChange("max_quantity", v)} />
      </div>
    </>
  );
}

function blankItem(file: string): any {
  switch (file) {
    case "rules.json": return { rule_id: "R-NEW", title: "New Rule", severity: "medium", logic: "", corrective_action: "", version: "1.0.0", source: "" };
    case "policies.json": return { policy_id: "NEW-POLICY", version: "1.0.0", payer_id: "", currency: "SAR", submission_window_days: 30, allowed_providers: [], auth_required_services: [], required_documents: {}, max_unit_price: {}, max_quantity_per_line: {} };
    case "diagnoses.json": return { code: "DX-NEW", display: "" };
    case "providers.json": return { provider_id: "NEW-PROV", display: "" };
    case "services.json": return { _key: "SVC-NEW", description: "", base_price: 0, max_price: 0, max_quantity: 1 };
    default: return {};
  }
}

export default function AdminPanel() {
  const [activeFile, setActiveFile] = useState("rules.json");
  const [data, setData] = useState<any[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const showToast = (type: "success" | "error", msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = useCallback(() => {
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
      .catch(e => showToast("error", e.message));
  }, [activeFile]);

  useEffect(() => { loadData(); }, [loadData]);

  const buildPayload = () => {
    if (activeFile === "services.json") {
      const obj: Record<string, any> = {};
      data.forEach(({ _key, ...rest }) => { if (_key) obj[_key] = rest; });
      return obj;
    }
    if (activeFile === "policies.json") {
      const obj: Record<string, any> = {};
      data.forEach(item => { if (item.policy_id) obj[item.policy_id] = item; });
      return obj;
    }
    return data;
  };

  const handleSave = () => {
    setSaving(true);
    apiFetch<{ status: string; message: string }>(`${API}/${activeFile}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    })
      .then(response => { showToast("success", response.message || "Saved successfully"); setDirty(false); })
      .catch(e => showToast("error", e.message))
      .finally(() => setSaving(false));
  };

  const handleDiscard = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    loadData();
  };

  const updateField = (field: string, value: any) => {
    if (selectedIndex === null) return;
    const next = [...data];
    next[selectedIndex] = { ...next[selectedIndex], [field]: value };
    setData(next);
    setDirty(true);
  };

  const addItem = () => {
    const item = blankItem(activeFile);
    const next = [...data, item];
    setData(next);
    setSelectedIndex(next.length - 1);
    setDirty(true);
  };

  const removeItem = () => {
    if (selectedIndex === null) return;
    if (!window.confirm("Delete this entry?")) return;
    const next = data.filter((_, i) => i !== selectedIndex);
    setData(next);
    setSelectedIndex(next.length > 0 ? Math.min(selectedIndex, next.length - 1) : null);
    setDirty(true);
    showToast("success", "Entry removed locally. Click Save to Backend to persist the deletion.");
  };

  const labelOf = (item: any) =>
    item.rule_id || item.policy_id || item.code || item.provider_id || item._key || "Untitled";

  const selectedItem = selectedIndex !== null ? data[selectedIndex] : null;

  const renderForm = () => {
    if (!selectedItem) return null;
    switch (activeFile) {
      case "rules.json":     return <RuleForm      item={selectedItem} onChange={updateField} />;
      case "policies.json":  return <PolicyForm    item={selectedItem} onChange={updateField} />;
      case "diagnoses.json": return <DiagnosisForm item={selectedItem} onChange={updateField} />;
      case "providers.json": return <ProviderForm  item={selectedItem} onChange={updateField} />;
      case "services.json":  return <ServiceForm   item={selectedItem} onChange={updateField} />;
      default: return null;
    }
  };

  return (
    <div className="page-shell" style={{ display: "flex", flexDirection: "column", height: "100%", gap: 20 }}>

      {toast && (
        <div style={{
          position: "fixed", bottom: 28, right: 28, zIndex: 9999,
          padding: "12px 20px", borderRadius: 10,
          background: toast.type === "success" ? "var(--status-pass-bg)" : "var(--status-fail-bg)",
          border: `1px solid ${toast.type === "success" ? "var(--status-pass-border)" : "var(--status-fail-border)"}`,
          color: toast.type === "success" ? "var(--status-pass-ink)" : "var(--status-fail-ink)",
          fontSize: "0.875rem", fontWeight: 600,
          boxShadow: "0 6px 24px rgba(0,0,0,0.15)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          {toast.type === "success"
            ? <svg width="15" height="15" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            : <svg width="15" height="15" viewBox="0 0 14 14" fill="none"><path d="M7 1v6M7 10v1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>}
          {toast.msg}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <span className="sc-eyebrow">Configuration</span>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.03em", color: "var(--text-primary)", margin: "10px 0 4px" }}>
            System Rules Admin
          </h1>
          <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
            Manage core configurations. Changes are written directly to the backend JSON files.
          </p>
        </div>
        {dirty && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 8, background: "color-mix(in srgb, var(--accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)", fontSize: "0.8125rem", fontWeight: 600, color: "var(--accent)" }}>
            Unsaved changes
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 20, flex: 1, minHeight: 0 }}>
        <div style={{ width: 230, display: "flex", flexDirection: "column", gap: 6 }}>
          {FILES.map(f => {
            const active = activeFile === f.id;
            return (
              <button
                key={f.id}
                onClick={() => {
                  if (dirty && !window.confirm("Switch file? Unsaved changes will be lost.")) return;
                  setActiveFile(f.id);
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 11, padding: "13px 15px",
                  background: active ? "var(--accent)" : "var(--card-bg)",
                  border: `1px solid ${active ? "var(--accent)" : "var(--card-border)"}`,
                  borderRadius: 11, cursor: "pointer", textAlign: "left",
                  color: active ? "#fff" : "var(--text-primary)",
                  fontWeight: active ? 600 : 500,
                  boxShadow: active ? "0 4px 12px rgba(15,122,130,0.25)" : "var(--card-shadow)",
                  transition: "all 0.18s ease",
                }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, opacity: active ? 1 : 0.65 }}>
                  {ICON_PATHS[f.id]}
                </svg>
                <div>
                  <div style={{ fontSize: "0.9rem" }}>{f.label}</div>
                  <div style={{ fontSize: "0.72rem", color: active ? "rgba(255,255,255,0.85)" : "var(--text-tertiary)", marginTop: 1, fontWeight: 400 }}>{f.id}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1, display: "flex", gap: 0, background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 12, boxShadow: "var(--card-shadow)", overflow: "hidden" }}>
          <div style={{ width: 240, borderRight: "1px solid var(--card-border)", display: "flex", flexDirection: "column", background: "var(--canvas-bg)" }}>
            <div style={{ padding: "13px 15px", borderBottom: "1px solid var(--card-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.825rem", fontWeight: 600, color: "var(--text-secondary)" }}>Entries ({data.length})</span>
              <button onClick={addItem} style={{ background: "var(--accent)", border: "none", borderRadius: 6, padding: "4px 11px", fontSize: "0.75rem", fontWeight: 700, color: "#fff", cursor: "pointer" }}>+ Add</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
              {data.map((item, i) => {
                const active = selectedIndex === i;
                return (
                  <button key={i} onClick={() => setSelectedIndex(i)} style={{
                    width: "100%", padding: "9px 11px", textAlign: "left", borderRadius: 7,
                    background: active ? "var(--accent-subtle)" : "transparent",
                    border: `1px solid ${active ? "color-mix(in srgb, var(--accent) 30%, transparent)" : "transparent"}`,
                    color: active ? "var(--accent)" : "var(--text-primary)",
                    fontWeight: active ? 600 : 500, fontSize: "0.85rem",
                    marginBottom: 3, cursor: "pointer", fontFamily: "inherit",
                  }}>
                    {labelOf(item)}
                  </button>
                );
              })}
              {data.length === 0 && <div style={{ padding: "20px 10px", color: "var(--text-tertiary)", fontSize: "0.8125rem", textAlign: "center" }}>No entries. Click + Add.</div>}
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            {selectedItem ? (
              <>
                <div style={{ padding: "14px 22px", borderBottom: "1px solid var(--card-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)" }}>{labelOf(selectedItem)}</div>
                    <div style={{ fontSize: "0.76rem", color: "var(--text-tertiary)", marginTop: 2 }}>Entry {(selectedIndex ?? 0) + 1} of {data.length}</div>
                  </div>
                  <button type="button" onClick={removeItem} style={{ background: "var(--status-fail-bg)", color: "var(--status-fail-ink)", border: "1px solid var(--status-fail-border)", padding: "6px 13px", borderRadius: 7, fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" }}>
                    Delete Entry
                  </button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "22px 26px" }}>
                  {renderForm()}
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-tertiary)", fontSize: "0.9375rem" }}>
                Select an entry to edit, or add a new one.
              </div>
            )}
            <div style={{ padding: "14px 22px", borderTop: "1px solid var(--card-border)", background: "var(--canvas-bg)", display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
              <button onClick={handleDiscard} style={{ background: "transparent", border: "1px solid var(--card-border)", borderRadius: 8, padding: "8px 16px", fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)", cursor: "pointer" }}>
                Discard Changes
              </button>
              <button onClick={handleSave} disabled={saving} className="btn btn-primary" style={{ padding: "8px 22px", opacity: saving ? 0.7 : 1 }}>
                {saving ? "Saving..." : "Save to Backend"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
