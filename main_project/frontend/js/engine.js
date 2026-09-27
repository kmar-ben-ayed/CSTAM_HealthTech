/**
 * ClaimGuard AI — Deterministic Rule Engine (JavaScript / Browser Port)
 * Faithfully mirrors CSTAM-VELODOC engine_core.py (15 Fictional Payer Rules)
 */

export const RULES_CONFIG = [
  {
    rule_id: "R001",
    title: "Required claim information",
    severity: "high",
    version: "1.0.0",
    source: "fictional-rulebook/R001@1.0.0",
    corrective_action: "Request the missing source information; never invent identifiers or diagnosis codes."
  },
  {
    rule_id: "R002",
    title: "Service and submission chronology",
    severity: "high",
    version: "1.0.0",
    source: "fictional-rulebook/R002@1.0.0",
    corrective_action: "Verify and correct dates against the original record."
  },
  {
    rule_id: "R003",
    title: "Coverage active on service date",
    severity: "high",
    version: "1.0.0",
    source: "fictional-rulebook/R003@1.0.0",
    corrective_action: "Verify coverage applicable on the service date with the source records."
  },
  {
    rule_id: "R004",
    title: "Member and beneficiary consistency",
    severity: "high",
    version: "1.0.0",
    source: "fictional-rulebook/R004@1.0.0",
    corrective_action: "Resolve the patient/member mismatch using the authoritative records."
  },
  {
    rule_id: "R005",
    title: "Provider in the supplied network",
    severity: "high",
    version: "1.0.0",
    source: "fictional-rulebook/R005@1.0.0",
    corrective_action: "Verify provider identity and the applicable fictional network list."
  },
  {
    rule_id: "R006",
    title: "Possible duplicate service lines",
    severity: "medium",
    version: "1.0.0",
    source: "fictional-rulebook/R006@1.0.0",
    corrective_action: "Ask the reviewer whether repeated lines represent separate documented services."
  },
  {
    rule_id: "R007",
    title: "Line arithmetic",
    severity: "high",
    version: "1.0.0",
    source: "fictional-rulebook/R007@1.0.0",
    corrective_action: "Check quantity, unit price and line amount; preserve the original values in the audit record."
  },
  {
    rule_id: "R008",
    title: "Required authorization reference",
    severity: "high",
    version: "1.0.0",
    source: "fictional-rulebook/R008@1.0.0",
    corrective_action: "Request the authorization reference or escalate its absence."
  },
  {
    rule_id: "R009",
    title: "Authorization record matches service",
    severity: "high",
    version: "1.0.0",
    source: "fictional-rulebook/R009@1.0.0",
    corrective_action: "Obtain or verify the applicable approval and its dates, service and quantity."
  },
  {
    rule_id: "R010",
    title: "Required supporting document",
    severity: "medium",
    version: "1.0.0",
    source: "fictional-rulebook/R010@1.0.0",
    corrective_action: "Request the correct final supporting document or send the draft for human review."
  },
  {
    rule_id: "R011",
    title: "Service code in fictional catalogue",
    severity: "high",
    version: "1.0.0",
    source: "fictional-rulebook/R011@1.0.0",
    corrective_action: "Verify the intended code against the supplied teaching catalogue."
  },
  {
    rule_id: "R012",
    title: "Claim total equals line amounts",
    severity: "high",
    version: "1.0.0",
    source: "fictional-rulebook/R012@1.0.0",
    corrective_action: "Reconcile the claim total with the submitted line amounts."
  },
  {
    rule_id: "R013",
    title: "Quantity and price limits",
    severity: "medium",
    version: "1.0.0",
    source: "fictional-rulebook/R013@1.0.0",
    corrective_action: "Verify the billed quantity and price against the fictional limits."
  },
  {
    rule_id: "R014",
    title: "Submission window",
    severity: "medium",
    version: "1.0.0",
    source: "fictional-rulebook/R014@1.0.0",
    corrective_action: "Review the submission dates and any exception with a human reviewer."
  },
  {
    rule_id: "R015",
    title: "Currency matches policy",
    severity: "high",
    version: "1.0.0",
    source: "fictional-rulebook/R015@1.0.0",
    corrective_action: "Verify and correct the declared currency against the source bill."
  }
];

export const POLICIES = {
  "EDU-BASIC": {
    policy_id: "EDU-BASIC",
    name: "Educational Basic Policy",
    submission_window_days: 30,
    currency: "SAR",
    allowed_providers: ["EDU-PROV-01", "EDU-PROV-02", "EDU-PROV-03"],
    auth_required_services: ["SVC-IMAGE", "SVC-THERAPY"],
    required_documents: {
      "SVC-IMAGE": "imaging-report",
      "SVC-DENTAL": "service-note"
    },
    max_unit_price: {
      "SVC-CONSULT": 350.0,
      "SVC-LAB": 260.0,
      "SVC-IMAGE": 2200.0,
      "SVC-THERAPY": 450.0,
      "SVC-DENTAL": 800.0,
      "SVC-PHARM": 200.0
    },
    max_quantity_per_line: {
      "SVC-CONSULT": 1,
      "SVC-LAB": 3,
      "SVC-IMAGE": 1,
      "SVC-THERAPY": 4,
      "SVC-DENTAL": 2,
      "SVC-PHARM": 10
    }
  },
  "EDU-PLUS": {
    policy_id: "EDU-PLUS",
    name: "Educational Plus Policy",
    submission_window_days: 60,
    currency: "SAR",
    allowed_providers: ["EDU-PROV-01", "EDU-PROV-02", "EDU-PROV-03"],
    auth_required_services: ["SVC-IMAGE", "SVC-THERAPY"],
    required_documents: {
      "SVC-IMAGE": "imaging-report",
      "SVC-DENTAL": "service-note"
    },
    max_unit_price: {
      "SVC-CONSULT": 350.0,
      "SVC-LAB": 260.0,
      "SVC-IMAGE": 2200.0,
      "SVC-THERAPY": 450.0,
      "SVC-DENTAL": 800.0,
      "SVC-PHARM": 200.0
    },
    max_quantity_per_line: {
      "SVC-CONSULT": 1,
      "SVC-LAB": 3,
      "SVC-IMAGE": 1,
      "SVC-THERAPY": 4,
      "SVC-DENTAL": 2,
      "SVC-PHARM": 10
    }
  }
};

export const SERVICES = [
  { code: "SVC-CONSULT", description: "Synthetic outpatient consultation", max_unit_price: 350, max_quantity: 1 },
  { code: "SVC-LAB", description: "Synthetic laboratory panel", max_unit_price: 260, max_quantity: 3 },
  { code: "SVC-IMAGE", description: "Synthetic imaging service", max_unit_price: 2200, max_quantity: 1 },
  { code: "SVC-THERAPY", description: "Synthetic therapy session", max_unit_price: 450, max_quantity: 4 },
  { code: "SVC-DENTAL", description: "Synthetic dental service", max_unit_price: 800, max_quantity: 2 },
  { code: "SVC-PHARM", description: "Synthetic pharmacy item", max_unit_price: 200, max_quantity: 10 }
];

export const VALID_SERVICE_CODES = new Set(SERVICES.map(s => s.code));

// Helper Functions
function isNullOrEmpty(v) {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function parseISODate(v) {
  if (!v || typeof v !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  const d = new Date(Date.UTC(year, month, day));
  if (d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day) {
    return d;
  }
  return null;
}

function roundMoney(num) {
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
}

function pointer(obj, path) {
  if (!path || path === "/") return obj;
  const parts = path.replace(/^\//, "").split("/");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    const clean = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      const idx = parseInt(clean, 10);
      current = current[idx];
    } else {
      current = current[clean];
    }
  }
  return current;
}

function makeResult(claim, rule, status, paths, message, lineIds = []) {
  const uniquePaths = [...new Set(paths)];
  return {
    claim_id: claim.claim_id,
    rule_id: rule.rule_id,
    rule_version: rule.version,
    rule_source: rule.source,
    title: rule.title,
    status: status,
    severity: rule.severity,
    affected_line_ids: lineIds || [],
    evidence: uniquePaths.map(p => ({
      path: p,
      value: pointer(claim, p)
    })),
    explanation: message,
    corrective_action: (status === "FAIL" || status === "UNABLE_TO_ASSESS") ? rule.corrective_action : "",
    confidence: null,
    confidence_kind: "not_probabilistic",
    requires_human_review: (status === "FAIL" || status === "UNABLE_TO_ASSESS"),
    method: "deterministic",
    review_status: "unreviewed"
  };
}

/**
 * Execute 15 rules on a single claim envelope
 */
export function evaluateClaim(claim) {
  const policy = POLICIES[claim?.policy_id] || null;
  const results = [];

  for (const rule of RULES_CONFIG) {
    const rid = rule.rule_id;
    let res = null;

    if (rid === "R001") {
      // Required claim information
      const paths = [];
      const ids = [];
      for (const k of ["invoice_number", "member_id", "diagnosis_code"]) {
        if (isNullOrEmpty(claim[k])) paths.push("/" + k);
      }
      if (Array.isArray(claim.lines)) {
        claim.lines.forEach((l, i) => {
          for (const k of ["service_date", "service_code", "quantity", "unit_price", "net_amount"]) {
            if (isNullOrEmpty(l[k])) {
              paths.push(`/lines/${i}/${k}`);
              if (l.line_id) ids.push(l.line_id);
            }
          }
        });
      }
      const status = paths.length > 0 ? "FAIL" : "PASS";
      const msg = paths.length > 0 
        ? `Missing required claim information: ${paths.join(", ")}.` 
        : "Required information is present.";
      res = makeResult(claim, rule, status, paths.length > 0 ? paths : ["/invoice_number", "/member_id", "/diagnosis_code", "/lines"], msg, [...new Set(ids)]);
    }

    else if (rid === "R002") {
      // Chronology
      const paths = [];
      const ids = [];
      let failed = false;
      let unknown = false;
      let errMsg = "";
      const subDate = parseISODate(claim.submission_date);

      if (!subDate) {
        paths.push("/submission_date");
        errMsg = "Submission date is missing or invalid.";
        unknown = true;
      }

      if (Array.isArray(claim.lines)) {
        claim.lines.forEach((l, i) => {
          const sDate = parseISODate(l.service_date);
          if (!sDate) {
            paths.push(`/lines/${i}/service_date`);
            if (l.line_id) ids.push(l.line_id);
            unknown = true;
            if (!failed && !errMsg) errMsg = `Service date in line ${i} is missing or invalid.`;
          } else if (subDate && sDate.getTime() > subDate.getTime()) {
            paths.push("/submission_date", `/lines/${i}/service_date`);
            if (l.line_id) ids.push(l.line_id);
            failed = true;
            errMsg = `Service date (${l.service_date}) is after submission date (${claim.submission_date}).`;
          }
        });
      }

      const status = failed ? "FAIL" : unknown ? "UNABLE_TO_ASSESS" : "PASS";
      res = makeResult(claim, rule, status, paths.length > 0 ? paths : ["/submission_date", "/lines"], errMsg || "All service dates are on or before submission date.", [...new Set(ids)]);
    }

    else if (rid === "R003") {
      // Coverage active
      const cv = claim.coverage || {};
      const start = parseISODate(cv.start_date);
      const end = parseISODate(cv.end_date);
      const paths = [];
      const ids = [];
      let failed = false;
      let unknown = false;
      let errMsg = "";

      if (cv.status !== "active") {
        paths.push("/coverage/status");
        failed = true;
        errMsg = `Coverage status '${cv.status || "null"}' is not active.`;
      }
      if (!start) { paths.push("/coverage/start_date"); unknown = true; }
      if (!end) { paths.push("/coverage/end_date"); unknown = true; }

      if (Array.isArray(claim.lines)) {
        claim.lines.forEach((l, i) => {
          const sDate = parseISODate(l.service_date);
          if (!sDate) {
            paths.push(`/lines/${i}/service_date`);
            if (l.line_id) ids.push(l.line_id);
            unknown = true;
          } else if (start && end) {
            if (sDate.getTime() < start.getTime() || sDate.getTime() > end.getTime()) {
              paths.push("/coverage/start_date", "/coverage/end_date", `/lines/${i}/service_date`);
              if (l.line_id) ids.push(l.line_id);
              failed = true;
              errMsg = `Service date ${l.service_date} falls outside active coverage period [${cv.start_date} to ${cv.end_date}].`;
            }
          }
        });
      }

      const status = failed ? "FAIL" : unknown ? "UNABLE_TO_ASSESS" : "PASS";
      res = makeResult(claim, rule, status, paths.length > 0 ? paths : ["/coverage/status", "/coverage/start_date", "/coverage/end_date"], errMsg || "Service dates are within active coverage period.", [...new Set(ids)]);
    }

    else if (rid === "R004") {
      // Member & beneficiary consistency
      const cv = claim.coverage || {};
      const paths = [];
      let failed = false;
      let unknown = false;
      let errMsg = "";

      if (isNullOrEmpty(claim.patient_id) || isNullOrEmpty(cv.beneficiary_patient_id)) {
        paths.push("/patient_id", "/coverage/beneficiary_patient_id");
        unknown = true;
      } else if (claim.patient_id !== cv.beneficiary_patient_id) {
        paths.push("/patient_id", "/coverage/beneficiary_patient_id");
        failed = true;
        errMsg = `Patient ID '${claim.patient_id}' does not match coverage beneficiary '${cv.beneficiary_patient_id}'.`;
      }

      if (isNullOrEmpty(claim.member_id) || isNullOrEmpty(cv.member_id)) {
        paths.push("/member_id", "/coverage/member_id");
        unknown = true;
      } else if (claim.member_id !== cv.member_id) {
        paths.push("/member_id", "/coverage/member_id");
        failed = true;
        errMsg = errMsg ? errMsg + " Member ID mismatch." : `Member ID '${claim.member_id}' does not match coverage member '${cv.member_id}'.`;
      }

      const status = failed ? "FAIL" : unknown ? "UNABLE_TO_ASSESS" : "PASS";
      res = makeResult(claim, rule, status, paths.length > 0 ? paths : ["/patient_id", "/member_id", "/coverage/beneficiary_patient_id", "/coverage/member_id"], errMsg || "Member and patient identifiers match coverage.", []);
    }

    else if (rid === "R005") {
      // Provider in network
      const paths = ["/provider_id"];
      let status = "PASS";
      let msg = "Provider is in network.";

      if (!policy) {
        status = "UNABLE_TO_ASSESS";
        msg = "Policy profile could not be resolved.";
      } else if (isNullOrEmpty(claim.provider_id)) {
        status = "UNABLE_TO_ASSESS";
        msg = "Provider ID is missing.";
      } else if (!policy.allowed_providers.includes(claim.provider_id)) {
        status = "FAIL";
        msg = `Provider '${claim.provider_id}' is not in policy allowed network [${policy.allowed_providers.join(", ")}].`;
      }
      res = makeResult(claim, rule, status, paths, msg);
    }

    else if (rid === "R006") {
      // Duplicate service lines
      const seen = new Map();
      const dupLineIds = [];
      const paths = [];
      let unknown = false;

      if (Array.isArray(claim.lines)) {
        claim.lines.forEach((l, i) => {
          if (isNullOrEmpty(l.service_code) || isNullOrEmpty(l.service_date)) {
            paths.push(`/lines/${i}/service_code`, `/lines/${i}/service_date`);
            unknown = true;
            return;
          }
          const mod = l.modifier === null || l.modifier === undefined ? "" : String(l.modifier).trim();
          const key = `${l.service_code}|${l.service_date}|${mod}`;
          if (seen.has(key)) {
            dupLineIds.push(seen.get(key));
            dupLineIds.push(l.line_id);
            paths.push(`/lines/${i}`);
          } else {
            seen.set(key, l.line_id);
          }
        });
      }

      const status = dupLineIds.length > 0 ? "FAIL" : unknown ? "UNABLE_TO_ASSESS" : "PASS";
      const msg = dupLineIds.length > 0 
        ? `Potential duplicate service lines detected on same date with matching code and modifier.` 
        : unknown ? "Missing service code or date to verify duplicates." : "No duplicate service lines detected.";
      res = makeResult(claim, rule, status, paths.length > 0 ? paths : ["/lines"], msg, [...new Set(dupLineIds)]);
    }

    else if (rid === "R007") {
      // Line arithmetic
      const paths = [];
      const ids = [];
      let failed = false;
      let unknown = false;
      let errMsg = "";

      if (Array.isArray(claim.lines)) {
        claim.lines.forEach((l, i) => {
          if (l.quantity === null || l.quantity === undefined || l.unit_price === null || l.unit_price === undefined || l.net_amount === null || l.net_amount === undefined) {
            paths.push(`/lines/${i}/quantity`, `/lines/${i}/unit_price`, `/lines/${i}/net_amount`);
            unknown = true;
            return;
          }
          const expected = roundMoney(Number(l.quantity) * Number(l.unit_price));
          const actual = roundMoney(Number(l.net_amount));
          if (Math.abs(expected - actual) > 0.01) {
            paths.push(`/lines/${i}/quantity`, `/lines/${i}/unit_price`, `/lines/${i}/net_amount`);
            if (l.line_id) ids.push(l.line_id);
            failed = true;
            errMsg = `Line ${l.line_id || i} arithmetic mismatch: ${l.quantity} * ${l.unit_price} = ${expected.toFixed(2)} SAR, but net_amount is ${actual.toFixed(2)} SAR.`;
          }
        });
      }

      const status = failed ? "FAIL" : unknown ? "UNABLE_TO_ASSESS" : "PASS";
      res = makeResult(claim, rule, status, paths.length > 0 ? paths : ["/lines"], errMsg || "Line amount arithmetic is correct.", [...new Set(ids)]);
    }

    else if (rid === "R008") {
      // Required authorization reference
      if (!policy) {
        res = makeResult(claim, rule, "UNABLE_TO_ASSESS", ["/policy_id"], "Policy could not be resolved.");
      } else {
        const paths = [];
        const ids = [];
        let reqCount = 0;
        let failed = false;
        let unknown = false;

        if (Array.isArray(claim.lines)) {
          claim.lines.forEach((l, i) => {
            if (isNullOrEmpty(l.service_code)) {
              unknown = true;
              return;
            }
            if (policy.auth_required_services.includes(l.service_code)) {
              reqCount++;
              if (isNullOrEmpty(l.authorization_id)) {
                paths.push(`/lines/${i}/authorization_id`);
                if (l.line_id) ids.push(l.line_id);
                failed = true;
              }
            }
          });
        }

        if (reqCount === 0 && !unknown) {
          res = makeResult(claim, rule, "NOT_APPLICABLE", ["/lines"], "No services requiring prior authorization in this claim.", []);
        } else {
          const status = failed ? "FAIL" : unknown ? "UNABLE_TO_ASSESS" : "PASS";
          res = makeResult(claim, rule, status, paths.length > 0 ? paths : ["/lines"], failed ? "Required authorization ID reference is missing for service." : "Required authorization references are present.", [...new Set(ids)]);
        }
      }
    }

    else if (rid === "R009") {
      // Authorization record matches service
      if (!policy) {
        res = makeResult(claim, rule, "UNABLE_TO_ASSESS", ["/policy_id"], "Policy could not be resolved.");
      } else {
        const auths = Array.isArray(claim.authorizations) ? claim.authorizations : [];
        const paths = [];
        const ids = [];
        let reqCount = 0;
        let failed = false;
        let unknown = false;
        let errMsg = "";

        const authUsage = new Map();

        if (Array.isArray(claim.lines)) {
          claim.lines.forEach((l, i) => {
            if (isNullOrEmpty(l.service_code)) { unknown = true; return; }
            if (policy.auth_required_services.includes(l.service_code)) {
              reqCount++;
              if (isNullOrEmpty(l.authorization_id)) {
                // Already caught in R008
                unknown = true;
                return;
              }
              const record = auths.find(a => a.authorization_id === l.authorization_id);
              if (!record) {
                paths.push(`/lines/${i}/authorization_id`, "/authorizations");
                if (l.line_id) ids.push(l.line_id);
                failed = true;
                errMsg = `Authorization '${l.authorization_id}' not found in authorization records.`;
                return;
              }

              if (record.status !== "approved") {
                paths.push("/authorizations");
                if (l.line_id) ids.push(l.line_id);
                failed = true;
                errMsg = `Authorization '${l.authorization_id}' status is '${record.status}', not approved.`;
              }
              if (record.patient_id !== claim.patient_id) {
                paths.push("/patient_id", "/authorizations");
                if (l.line_id) ids.push(l.line_id);
                failed = true;
                errMsg = `Authorization patient mismatch.`;
              }
              if (record.service_code !== l.service_code) {
                paths.push(`/lines/${i}/service_code`, "/authorizations");
                if (l.line_id) ids.push(l.line_id);
                failed = true;
                errMsg = `Authorization service mismatch: auth is for ${record.service_code}, line is ${l.service_code}.`;
              }

              const sDate = parseISODate(l.service_date);
              const vFrom = parseISODate(record.valid_from);
              const vTo = parseISODate(record.valid_to);
              if (sDate && vFrom && vTo) {
                if (sDate.getTime() < vFrom.getTime() || sDate.getTime() > vTo.getTime()) {
                  paths.push(`/lines/${i}/service_date`, "/authorizations");
                  if (l.line_id) ids.push(l.line_id);
                  failed = true;
                  errMsg = `Service date ${l.service_date} outside authorization validity [${record.valid_from} to ${record.valid_to}].`;
                }
              }

              const currQty = (authUsage.get(l.authorization_id) || 0) + (Number(l.quantity) || 0);
              authUsage.set(l.authorization_id, currQty);
              if (record.max_quantity && currQty > record.max_quantity) {
                paths.push(`/lines/${i}/quantity`, "/authorizations");
                if (l.line_id) ids.push(l.line_id);
                failed = true;
                errMsg = `Cumulative quantity ${currQty} exceeds authorization max quantity ${record.max_quantity}.`;
              }
            }
          });
        }

        if (reqCount === 0 && !unknown) {
          res = makeResult(claim, rule, "NOT_APPLICABLE", ["/lines"], "No services requiring authorization evaluation.", []);
        } else {
          const status = failed ? "FAIL" : unknown ? "UNABLE_TO_ASSESS" : "PASS";
          res = makeResult(claim, rule, status, paths.length > 0 ? paths : ["/authorizations"], errMsg || "Authorization records valid and match service lines.", [...new Set(ids)]);
        }
      }
    }

    else if (rid === "R010") {
      // Required supporting document
      if (!policy) {
        res = makeResult(claim, rule, "UNABLE_TO_ASSESS", ["/policy_id"], "Policy could not be resolved.");
      } else {
        const atts = Array.isArray(claim.attachments) ? claim.attachments : [];
        const paths = [];
        const ids = [];
        let reqCount = 0;
        let failed = false;
        let unknown = false;
        let errMsg = "";

        if (Array.isArray(claim.lines)) {
          claim.lines.forEach((l, i) => {
            if (isNullOrEmpty(l.service_code)) { unknown = true; return; }
            const reqDoc = policy.required_documents[l.service_code];
            if (reqDoc) {
              reqCount++;
              const matchAtts = atts.filter(a => 
                a.document_type === reqDoc &&
                a.patient_id === claim.patient_id &&
                a.service_code === l.service_code &&
                a.service_date === l.service_date
              );

              if (matchAtts.length === 0) {
                paths.push(`/lines/${i}/service_code`, "/attachments");
                if (l.line_id) ids.push(l.line_id);
                failed = true;
                errMsg = `Missing required '${reqDoc}' document for ${l.service_code} on ${l.service_date}.`;
              } else {
                const hasFinal = matchAtts.some(a => a.document_status === "final");
                if (!hasFinal) {
                  paths.push("/attachments");
                  if (l.line_id) ids.push(l.line_id);
                  unknown = true;
                  if (!failed && !errMsg) errMsg = `Matching '${reqDoc}' document exists but status is draft/unfinalized.`;
                }
              }
            }
          });
        }

        if (reqCount === 0 && !unknown) {
          res = makeResult(claim, rule, "NOT_APPLICABLE", ["/lines"], "No mandatory clinical documents required for billed services.", []);
        } else {
          const status = failed ? "FAIL" : unknown ? "UNABLE_TO_ASSESS" : "PASS";
          res = makeResult(claim, rule, status, paths.length > 0 ? paths : ["/attachments"], errMsg || "Required supporting documents are verified and finalized.", [...new Set(ids)]);
        }
      }
    }

    else if (rid === "R011") {
      // Service code catalogue
      const paths = [];
      const ids = [];
      let failed = false;
      let unknown = false;
      let errMsg = "";

      if (Array.isArray(claim.lines)) {
        claim.lines.forEach((l, i) => {
          if (isNullOrEmpty(l.service_code)) {
            paths.push(`/lines/${i}/service_code`);
            unknown = true;
          } else if (!VALID_SERVICE_CODES.has(l.service_code)) {
            paths.push(`/lines/${i}/service_code`);
            if (l.line_id) ids.push(l.line_id);
            failed = true;
            errMsg = `Service code '${l.service_code}' is not in approved procedure catalogue.`;
          }
        });
      }

      const status = failed ? "FAIL" : unknown ? "UNABLE_TO_ASSESS" : "PASS";
      res = makeResult(claim, rule, status, paths.length > 0 ? paths : ["/lines"], errMsg || "All service codes exist in catalogue.", [...new Set(ids)]);
    }

    else if (rid === "R012") {
      // Claim total equals line amounts
      const paths = ["/total_amount"];
      let status = "PASS";
      let msg = "Claim total matches sum of line net amounts.";
      let totalLines = 0;
      let unknown = isNullOrEmpty(claim.total_amount);

      if (Array.isArray(claim.lines)) {
        claim.lines.forEach((l, i) => {
          if (isNullOrEmpty(l.net_amount)) {
            paths.push(`/lines/${i}/net_amount`);
            unknown = true;
          } else {
            totalLines += Number(l.net_amount) || 0;
          }
        });
      }

      if (unknown) {
        status = "UNABLE_TO_ASSESS";
        msg = "Missing total amount or line net amount to reconcile total.";
      } else {
        const roundedSum = roundMoney(totalLines);
        const actualTotal = roundMoney(Number(claim.total_amount));
        if (Math.abs(roundedSum - actualTotal) > 0.01) {
          status = "FAIL";
          msg = `Claim total ${actualTotal.toFixed(2)} SAR does not equal sum of lines ${roundedSum.toFixed(2)} SAR.`;
        }
      }
      res = makeResult(claim, rule, status, paths, msg);
    }

    else if (rid === "R013") {
      // Quantity and price limits
      if (!policy) {
        res = makeResult(claim, rule, "UNABLE_TO_ASSESS", ["/policy_id"], "Policy could not be resolved.");
      } else {
        const paths = [];
        const ids = [];
        let failed = false;
        let unknown = false;
        let errMsg = "";

        if (Array.isArray(claim.lines)) {
          claim.lines.forEach((l, i) => {
            if (isNullOrEmpty(l.service_code) || isNullOrEmpty(l.quantity) || isNullOrEmpty(l.unit_price)) {
              paths.push(`/lines/${i}`);
              unknown = true;
              return;
            }
            const maxPrice = policy.max_unit_price[l.service_code];
            const maxQty = policy.max_quantity_per_line[l.service_code];

            if (maxPrice === undefined || maxQty === undefined) {
              paths.push(`/lines/${i}/service_code`);
              unknown = true;
              return;
            }

            const qty = Number(l.quantity);
            const price = Number(l.unit_price);

            if (!Number.isInteger(qty) || qty <= 0 || qty > maxQty) {
              paths.push(`/lines/${i}/quantity`);
              if (l.line_id) ids.push(l.line_id);
              failed = true;
              errMsg = `Quantity ${qty} for ${l.service_code} exceeds max limit of ${maxQty}.`;
            }
            if (price <= 0 || price > maxPrice) {
              paths.push(`/lines/${i}/unit_price`);
              if (l.line_id) ids.push(l.line_id);
              failed = true;
              errMsg = errMsg ? errMsg + ` Price ${price} exceeds max ${maxPrice}.` : `Unit price ${price} SAR for ${l.service_code} exceeds max policy rate of ${maxPrice} SAR.`;
            }
          });
        }

        const status = failed ? "FAIL" : unknown ? "UNABLE_TO_ASSESS" : "PASS";
        res = makeResult(claim, rule, status, paths.length > 0 ? paths : ["/lines"], errMsg || "All line quantities and unit prices within fee schedule limits.", [...new Set(ids)]);
      }
    }

    else if (rid === "R014") {
      // Submission window
      if (!policy) {
        res = makeResult(claim, rule, "UNABLE_TO_ASSESS", ["/policy_id"], "Policy could not be resolved.");
      } else {
        const subDate = parseISODate(claim.submission_date);
        const paths = ["/submission_date"];
        let latestServiceDate = null;
        let unknown = !subDate;

        if (Array.isArray(claim.lines)) {
          claim.lines.forEach((l, i) => {
            const d = parseISODate(l.service_date);
            if (!d) {
              paths.push(`/lines/${i}/service_date`);
              unknown = true;
            } else if (!latestServiceDate || d.getTime() > latestServiceDate.getTime()) {
              latestServiceDate = d;
            }
          });
        }

        if (unknown || !latestServiceDate) {
          res = makeResult(claim, rule, "UNABLE_TO_ASSESS", paths, "Missing submission date or service date to calculate filing lag.");
        } else {
          const diffMs = subDate.getTime() - latestServiceDate.getTime();
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          if (diffDays < 0) {
            // Service in future handled by R002
            res = makeResult(claim, rule, "NOT_APPLICABLE", paths, "Service date is in future (handled by R002 chronology check).");
          } else if (diffDays > policy.submission_window_days) {
            res = makeResult(claim, rule, "FAIL", paths, `Filing lag of ${diffDays} days exceeds policy limit of ${policy.submission_window_days} days.`);
          } else {
            res = makeResult(claim, rule, "PASS", paths, `Filing lag of ${diffDays} days is within timely submission window (${policy.submission_window_days} days).`);
          }
        }
      }
    }

    else if (rid === "R015") {
      // Currency matches policy
      const paths = ["/currency"];
      let status = "PASS";
      let msg = "Currency matches policy requirement (SAR).";

      if (!policy) {
        status = "UNABLE_TO_ASSESS";
        msg = "Policy profile could not be resolved.";
      } else if (isNullOrEmpty(claim.currency)) {
        status = "UNABLE_TO_ASSESS";
        msg = "Claim currency is missing.";
      } else if (claim.currency !== policy.currency) {
        status = "FAIL";
        msg = `Claim currency '${claim.currency}' does not match required policy currency '${policy.currency}'.`;
      }
      res = makeResult(claim, rule, status, paths, msg);
    }

    if (res) results.push(res);
  }

  return results;
}
