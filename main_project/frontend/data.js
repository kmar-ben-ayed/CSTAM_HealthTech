/**
 * ClaimGuard AI — Data Layer & Parsers
 * Manages dataset loading, JSONL parsing, CSV conversion, and FHIR mapping.
 */

import { evaluateClaim } from './engine.js';

export class ClaimDataManager {
  constructor() {
    this.claims = [];
    this.evaluations = new Map(); // claim_id -> Array of 15 RuleResults
    this.currentDatasetName = "Worked Examples (10 Cases)";
  }

  loadClaims(claimsArray, datasetName = "Custom Dataset", evaluationsByClaim = null) {
    this.claims = claimsArray;
    this.currentDatasetName = datasetName;
    this.evaluations.clear();
    
    // Prefer authoritative backend results when supplied; use the browser
    // evaluator only for local uploads and offline fallback datasets.
    this.claims.forEach(c => {
      const results = evaluationsByClaim?.[c.claim_id] || evaluateClaim(c);
      this.evaluations.set(c.claim_id, results);
    });

    return {
      total: this.claims.length,
      dataset: datasetName
    };
  }

  getClaim(claimId) {
    return this.claims.find(c => c.claim_id === claimId);
  }

  getEvaluation(claimId) {
    return this.evaluations.get(claimId) || [];
  }

  updateClaim(claimId, updatedClaim) {
    const idx = this.claims.findIndex(c => c.claim_id === claimId);
    if (idx !== -1) {
      this.claims[idx] = updatedClaim;
      const newResults = evaluateClaim(updatedClaim);
      this.evaluations.set(claimId, newResults);
      return newResults;
    }
    return null;
  }

  /**
   * Parse JSONL text (one JSON claim per line)
   */
  parseJSONL(text) {
    const lines = text.split("\n");
    const parsed = [];
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed) {
        try {
          parsed.push(JSON.parse(trimmed));
        } catch (e) {
          console.warn("Invalid JSON line skipped:", trimmed);
        }
      }
    });
    return parsed;
  }

  /**
   * Simple CSV parser for relational claim rows
   */
  parseCSV(csvText) {
    const lines = csvText.trim().split("\n");
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1);
    
    const claimsMap = new Map();

    rows.forEach(r => {
      if (!r.trim()) return;
      const cols = r.split(",").map(c => c.trim().replace(/^"|"$/g, ''));
      const obj = {};
      headers.forEach((h, i) => obj[h] = cols[i] !== undefined ? cols[i] : null);

      const claimId = obj.claim_id;
      if (!claimId) return;

      if (!claimsMap.has(claimId)) {
        claimsMap.set(claimId, {
          schema_version: "1.0.0",
          claim_id: claimId,
          invoice_number: obj.invoice_number || `INV-${claimId}`,
          patient_id: obj.patient_id || "PAT-UNKNOWN",
          member_id: obj.member_id || "MEM-UNKNOWN",
          provider_id: obj.provider_id || "EDU-PROV-01",
          payer_id: obj.payer_id || "EDU-PAYER",
          policy_id: obj.policy_id || "EDU-BASIC",
          diagnosis_code: obj.diagnosis_code || "DX-EDU-01",
          submission_date: obj.submission_date || new Date().toISOString().split("T")[0],
          currency: obj.currency || "SAR",
          total_amount: parseFloat(obj.total_amount) || 0,
          coverage: {
            coverage_id: `COV-${claimId}`,
            status: obj.coverage_status || "active",
            beneficiary_patient_id: obj.beneficiary_patient_id || obj.patient_id,
            member_id: obj.coverage_member_id || obj.member_id,
            start_date: obj.coverage_start || "2026-01-01",
            end_date: obj.coverage_end || "2026-12-31"
          },
          lines: [],
          authorizations: [],
          attachments: [],
          notes: "Imported via CSV"
        });
      }

      // Add line item if present
      if (obj.service_code) {
        claimsMap.get(claimId).lines.push({
          line_id: obj.line_id || `L${claimsMap.get(claimId).lines.length + 1}`,
          service_code: obj.service_code,
          service_date: obj.service_date,
          modifier: obj.modifier || null,
          quantity: parseInt(obj.quantity, 10) || 1,
          unit_price: parseFloat(obj.unit_price) || 0,
          net_amount: parseFloat(obj.net_amount) || 0,
          authorization_id: obj.authorization_id || null
        });
      }
    });

    return Array.from(claimsMap.values());
  }

  /**
   * FHIR R4 Claim to ClaimGuard Normalized JSON mapper
   */
  parseFHIRClaim(fhirResource) {
    if (!fhirResource || fhirResource.resourceType !== "Claim") {
      throw new Error("Invalid FHIR payload: resourceType must be 'Claim'");
    }

    const claimId = fhirResource.id || `CLM-FHIR-${Date.now()}`;
    const lines = [];

    if (Array.isArray(fhirResource.item)) {
      fhirResource.item.forEach((it, idx) => {
        lines.push({
          line_id: `L${it.sequence || idx + 1}`,
          service_code: it.productOrService?.coding?.[0]?.code || "SVC-CONSULT",
          service_date: it.servicedDate || fhirResource.created || new Date().toISOString().split("T")[0],
          modifier: it.modifier?.[0]?.coding?.[0]?.code || null,
          quantity: it.quantity?.value || 1,
          unit_price: it.unitPrice?.value || 0,
          net_amount: it.net?.value || 0,
          authorization_id: null
        });
      });
    }

    return {
      schema_version: "1.0.0",
      claim_id: claimId,
      invoice_number: `INV-${claimId}`,
      patient_id: fhirResource.patient?.reference?.replace(/^Patient\//, '') || "PAT-1001",
      member_id: fhirResource.insurance?.[0]?.coverage?.reference?.replace(/^Coverage\//, '') || "MEM-1001",
      provider_id: fhirResource.provider?.reference?.replace(/^Organization\//, '') || "EDU-PROV-01",
      payer_id: "EDU-PAYER",
      policy_id: "EDU-BASIC",
      diagnosis_code: fhirResource.diagnosis?.[0]?.diagnosisCodeableConcept?.coding?.[0]?.code || "DX-EDU-01",
      submission_date: fhirResource.created || new Date().toISOString().split("T")[0],
      currency: fhirResource.total?.currency || "SAR",
      total_amount: fhirResource.total?.value || 0,
      coverage: {
        coverage_id: `COV-${claimId}`,
        status: "active",
        beneficiary_patient_id: fhirResource.patient?.reference?.replace(/^Patient\//, '') || "PAT-1001",
        member_id: fhirResource.insurance?.[0]?.coverage?.reference?.replace(/^Coverage\//, '') || "MEM-1001",
        start_date: "2026-01-01",
        end_date: "2026-12-31"
      },
      lines: lines,
      authorizations: [],
      attachments: [],
      notes: "FHIR R4 Educational Projection"
    };
  }

  getOverallStatistics() {
    let totalClaims = this.claims.length;
    let cleanPassClaims = 0;
    let failedClaims = 0;
    let uncertainClaims = 0;
    let totalSAR = 0;
    let flaggedSAR = 0;
    let ruleFailFrequencies = {};

    for (let i = 1; i <= 15; i++) {
      const rid = `R${String(i).padStart(3, "0")}`;
      ruleFailFrequencies[rid] = { fail: 0, uncertain: 0, pass: 0, not_app: 0 };
    }

    this.claims.forEach(c => {
      totalSAR += Number(c.total_amount) || 0;
      const res = this.evaluations.get(c.claim_id) || [];
      const hasFail = res.some(r => r.status === "FAIL");
      const hasUncertain = res.some(r => r.status === "UNABLE_TO_ASSESS");

      if (hasFail) {
        failedClaims++;
        flaggedSAR += Number(c.total_amount) || 0;
      } else if (hasUncertain) {
        uncertainClaims++;
      } else {
        cleanPassClaims++;
      }

      res.forEach(r => {
        if (ruleFailFrequencies[r.rule_id]) {
          if (r.status === "FAIL") ruleFailFrequencies[r.rule_id].fail++;
          else if (r.status === "UNABLE_TO_ASSESS") ruleFailFrequencies[r.rule_id].uncertain++;
          else if (r.status === "PASS") ruleFailFrequencies[r.rule_id].pass++;
          else if (r.status === "NOT_APPLICABLE") ruleFailFrequencies[r.rule_id].not_app++;
        }
      });
    });

    return {
      totalClaims,
      cleanPassClaims,
      failedClaims,
      uncertainClaims,
      passRate: totalClaims > 0 ? ((cleanPassClaims / totalClaims) * 100).toFixed(1) : "0.0",
      totalSAR,
      flaggedSAR,
      ruleFailFrequencies
    };
  }
}

export const dataManager = new ClaimDataManager();
