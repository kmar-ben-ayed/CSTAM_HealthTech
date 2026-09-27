/**
 * ClaimGuard AI — Bounded AI Copilot Layer
 * Grounded strictly on verified deterministic findings, with prompt-injection defense and citation linking.
 */

export class AICopilot {
  constructor() {
    this.modelName = "ClaimGuard-Grounded-L1";
    this.safetyShieldActive = true;
  }

  /**
   * Sanitizes and verifies unstructured clinical text against prompt injection attacks
   */
  sanitizeClinicalNotes(text) {
    if (!text || typeof text !== "string") return { safe: true, text: "" };
    
    // Check for common prompt injection patterns in clinical notes
    const injectionPatterns = [
      /ignore (all )?previous instructions/i,
      /system prompt/i,
      /you are now a/i,
      /override (all )?rules/i,
      /mark (this )?claim as pass/i,
      /disregard policies/i
    ];

    let suspicious = false;
    for (const pattern of injectionPatterns) {
      if (pattern.test(text)) {
        suspicious = true;
        break;
      }
    }

    return {
      safe: !suspicious,
      suspicious: suspicious,
      rawText: text,
      shieldNote: suspicious ? "⚠️ Prompt injection pattern detected in attachment/note text. Content isolated strictly as untrusted clinical data." : null
    };
  }

  /**
   * Generates a grounded natural language summary strictly citing deterministic failures and evidence paths.
   */
  generateExplanation(claim, ruleResults) {
    const failedRules = ruleResults.filter(r => r.status === "FAIL");
    const uncertainRules = ruleResults.filter(r => r.status === "UNABLE_TO_ASSESS");
    const passRules = ruleResults.filter(r => r.status === "PASS");

    // Extract citations
    const citedPaths = [];
    failedRules.forEach(r => {
      r.evidence.forEach(ev => {
        if (ev.path) citedPaths.push(ev.path);
      });
    });

    let summary = "";
    let severity = "low";
    let handoverNotes = [];
    let needsHumanReview = false;

    if (failedRules.length === 0 && uncertainRules.length === 0) {
      summary = `Claim ${claim.claim_id} passed all 15 deterministic payer validation rules across policy ${claim.policy_id}. The claim is arithmetically balanced, all procedure codes are cataloged, and authorizations/documents match requirements. Recommended for submission.`;
      severity = "clean";
      needsHumanReview = false;
    } else {
      needsHumanReview = true;
      const failCount = failedRules.length;
      const uncCount = uncertainRules.length;
      
      const hasHighSeverity = failedRules.some(r => r.severity === "high");
      severity = hasHighSeverity ? "high" : "medium";

      summary = `Claim ${claim.claim_id} requires human review before submission. The pre-validation engine detected ${failCount} rule violation${failCount > 1 ? "s" : ""}${uncCount > 0 ? ` and ${uncCount} unresolved uncertainty check${uncCount > 1 ? "s" : ""}` : ""}.`;

      failedRules.forEach(r => {
        handoverNotes.push({
          rule_id: r.rule_id,
          title: r.title,
          severity: r.severity,
          explanation: r.explanation,
          action: r.corrective_action,
          evidence_paths: r.evidence.map(e => e.path),
          affected_lines: r.affected_line_ids
        });
      });

      uncertainRules.forEach(r => {
        handoverNotes.push({
          rule_id: r.rule_id,
          title: r.title,
          severity: r.severity,
          explanation: `Uncertainty: ${r.explanation}`,
          action: r.corrective_action || "Verify missing data in source records.",
          evidence_paths: r.evidence.map(e => e.path),
          affected_lines: r.affected_line_ids
        });
      });
    }

    return {
      model: this.modelName,
      generated_at: new Date().toISOString(),
      summary: summary,
      overall_severity: severity,
      needs_human_review: needsHumanReview,
      passed_count: passRules.length,
      failed_count: failedRules.length,
      uncertain_count: uncertainRules.length,
      handover_notes: handoverNotes,
      cited_evidence_paths: [...new Set(citedPaths)],
      disclaimer: "Grounded AI Output: Explanations are strictly bound to deterministic findings and cannot override rule results. Self-reported AI confidence is not calibrated for reimbursement probability."
    };
  }
}

export const copilotInstance = new AICopilot();
