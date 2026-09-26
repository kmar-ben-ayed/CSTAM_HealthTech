/**
 * ClaimGuard AI — Frontend Application Controller (Enterprise Edition)
 * Handles UI interactions, reactive state, pagination, deep inspection, review actions, and audit logging.
 */

import { RULES_CONFIG, POLICIES, SERVICES, evaluateClaim } from './engine.js';
import { PRESET_DATASETS } from './datasets.js';
import { dataManager } from './data.js';
import { globalAudit } from './audit.js';
import { copilotInstance } from './ai_copilot.js';

class ClaimGuardApp {
  constructor() {
    this.currentView = 'dashboard';
    this.selectedClaimId = null;
    this.activeFilter = 'all';
    this.searchQuery = '';
    
    // Pagination State
    this.currentPage = 1;
    this.pageSize = 25;

    this.init();
  }

  async init() {
    // 1. Initialize Audit Log
    await globalAudit.init();

    // 2. Load Default Benchmark Dataset (Worked Cases)
    this.loadDataset('worked_cases');

    // 3. Bind Event Listeners
    this.bindEvents();

    // 4. Render Initial Views
    this.renderDashboard();
    this.renderQueue();
    this.renderRulebook();
    this.renderAuditTimeline();
  }

  loadDataset(key) {
    const dataset = PRESET_DATASETS[key];
    if (dataset) {
      dataManager.loadClaims(dataset.claims, dataset.name);
      globalAudit.logEvent('INGEST_DATASET', { dataset: dataset.name, count: dataset.claims.length });
      
      this.currentPage = 1;

      // Select first claim by default
      if (dataset.claims.length > 0) {
        this.selectedClaimId = dataset.claims[0].claim_id;
      }

      this.updateAllViews();
    }
  }

  bindEvents() {
    // Navigation Menu Items
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (view) this.switchView(view);
      });
    });

    // Dataset Select
    const datasetSelect = document.getElementById('dataset-selector');
    if (datasetSelect) {
      datasetSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'custom_upload') {
          this.switchView('upload');
        } else {
          this.loadDataset(val);
        }
      });
    }

    // Search Trigger (Topbar Button & Command-K)
    const topbarSearch = document.getElementById('topbar-search-trigger');
    const queueSearchInput = document.getElementById('queue-search-input');
    if (topbarSearch && queueSearchInput) {
      topbarSearch.addEventListener('click', () => {
        this.switchView('queue');
        queueSearchInput.focus();
      });
    }

    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.switchView('queue');
        if (queueSearchInput) queueSearchInput.focus();
      }
    });

    if (queueSearchInput) {
      queueSearchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.currentPage = 1;
        this.renderQueue();
      });
    }

    // Segmented Filters
    document.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = btn.dataset.filter;
        this.currentPage = 1;
        this.renderQueue();
      });
    });

    // Pagination Controls
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (this.currentPage > 1) {
          this.currentPage--;
          this.renderQueue();
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        const totalFiltered = this.getFilteredClaims().length;
        const maxPage = Math.ceil(totalFiltered / this.pageSize) || 1;
        if (this.currentPage < maxPage) {
          this.currentPage++;
          this.renderQueue();
        }
      });
    }

    // Theme Toggle
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const currentTheme = document.body.getAttribute('data-theme') || 'dark';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.body.setAttribute('data-theme', newTheme);
        themeBtn.textContent = newTheme === 'dark' ? '🌙' : '☀️';
      });
    }

    // Verify Audit Chain Button
    const verifyAuditBtn = document.getElementById('verify-audit-btn');
    if (verifyAuditBtn) {
      verifyAuditBtn.addEventListener('click', async () => {
        const res = await globalAudit.verifyChain();
        const badge = document.getElementById('audit-integrity-badge');
        const topbarBadge = document.getElementById('topbar-audit-status');
        if (badge) {
          if (res.valid) {
            badge.className = 'chip chip-pass';
            badge.textContent = `✓ Chain Cryptographically Verified (${res.totalBlocks} Blocks)`;
            if (topbarBadge) topbarBadge.textContent = '🛡️ SHA-256 Valid';
          } else {
            badge.className = 'chip chip-fail';
            badge.textContent = `✗ ${res.error}`;
            if (topbarBadge) topbarBadge.textContent = '⚠️ Tamper Detected';
          }
        }
      });
    }

    // File Upload Handler
    const dropZone = document.getElementById('upload-drop-zone');
    const fileInput = document.getElementById('file-upload-input');
    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => this.handleFileUpload(e.target.files[0]));
    }

    // Human Decision Studio Buttons
    const btnConfirm = document.getElementById('btn-action-confirm');
    const btnDismiss = document.getElementById('btn-action-dismiss');
    const btnRequest = document.getElementById('btn-action-request');
    const btnEditRecheck = document.getElementById('btn-action-edit');

    if (btnConfirm) btnConfirm.addEventListener('click', () => this.handleReviewAction('CONFIRM_DEFECT'));
    if (btnDismiss) btnDismiss.addEventListener('click', () => this.handleReviewAction('DISMISS_FALSE_ALARM'));
    if (btnRequest) btnRequest.addEventListener('click', () => this.openRequestInfoModal());
    if (btnEditRecheck) btnEditRecheck.addEventListener('click', () => this.openEditClaimModal());
  }

  switchView(viewName) {
    this.currentView = viewName;

    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    // GLITCH FIX: remove active from all views first, then add to target
    // This ensures the animation always re-triggers cleanly
    document.querySelectorAll('.view').forEach(sec => {
      sec.classList.remove('active');
    });
    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) {
      // Force a reflow so the animation re-triggers
      void targetView.offsetHeight;
      targetView.classList.add('active');
    }

    if (viewName === 'dashboard') this.renderDashboard();
    if (viewName === 'queue') this.renderQueue();
    if (viewName === 'inspector') this.renderInspector();
    if (viewName === 'audit') this.renderAuditTimeline();
    if (viewName === 'rulebook') this.renderRulebook();
  }

  updateAllViews() {
    this.renderDashboard();
    this.renderQueue();
    if (this.selectedClaimId) this.renderInspector();
    this.renderAuditTimeline();
    this.renderRulebook();

    // Update sidebar queue count badge
    const countBadge = document.getElementById('sidebar-queue-count');
    if (countBadge) countBadge.textContent = dataManager.claims.length;
  }

  renderDashboard() {
    const stats = dataManager.getOverallStatistics();

    // KPIs
    document.getElementById('kpi-total-claims').textContent = stats.totalClaims;
    document.getElementById('kpi-pass-rate').textContent = `${stats.passRate}%`;
    document.getElementById('kpi-flagged-sar').textContent = `${stats.flaggedSAR.toLocaleString()} SAR`;
    document.getElementById('kpi-uncertain-claims').textContent = stats.uncertainClaims;

    // 15-Rule Frequency Matrix
    const listContainer = document.getElementById('rule-frequency-bars');
    if (listContainer) {
      listContainer.innerHTML = '';
      RULES_CONFIG.forEach(r => {
        const freq = stats.ruleFailFrequencies[r.rule_id] || { fail: 0, uncertain: 0, pass: 0 };
        const failPercent = stats.totalClaims > 0 ? (freq.fail / stats.totalClaims) * 100 : 0;

        const row = document.createElement('div');
        row.className = 'rule-bar-row';
        row.innerHTML = `
          <div class="rule-pill">${r.rule_id}</div>
          <div class="rule-name" title="${r.title}">${r.title}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${failPercent}%;"></div>
          </div>
          <div style="text-align:right;">
            <span class="chip ${freq.fail > 0 ? 'chip-fail' : 'chip-pass'}">${freq.fail > 0 ? `${freq.fail} FAIL` : 'PASS'}</span>
          </div>
        `;
        listContainer.appendChild(row);
      });
    }
  }

  getFilteredClaims() {
    return dataManager.claims.filter(c => {
      const evalRes = dataManager.getEvaluation(c.claim_id);
      const hasFail = evalRes.some(r => r.status === 'FAIL');
      const hasUncertain = evalRes.some(r => r.status === 'UNABLE_TO_ASSESS');
      const isClean = !hasFail && !hasUncertain;

      // Filter Segment
      if (this.activeFilter === 'ready' && !isClean) return false;
      if (this.activeFilter === 'review' && !hasFail) return false;
      if (this.activeFilter === 'uncertain' && !hasUncertain) return false;

      // Search Query
      if (this.searchQuery) {
        const matchesId = c.claim_id.toLowerCase().includes(this.searchQuery);
        const matchesPatient = c.patient_id.toLowerCase().includes(this.searchQuery);
        const matchesInvoice = (c.invoice_number || '').toLowerCase().includes(this.searchQuery);
        const matchesPolicy = (c.policy_id || '').toLowerCase().includes(this.searchQuery);
        if (!matchesId && !matchesPatient && !matchesInvoice && !matchesPolicy) return false;
      }

      return true;
    });
  }

  renderQueue() {
    const tableBody = document.getElementById('claims-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = '';
    const filtered = this.getFilteredClaims();

    const totalCount = filtered.length;
    const maxPage = Math.ceil(totalCount / this.pageSize) || 1;
    if (this.currentPage > maxPage) this.currentPage = maxPage;

    const startIdx = (this.currentPage - 1) * this.pageSize;
    const endIdx = Math.min(startIdx + this.pageSize, totalCount);
    const pageItems = filtered.slice(startIdx, endIdx);

    // Update pagination labels
    const pageInfo = document.getElementById('pagination-info-text');
    const pageLabel = document.getElementById('current-page-label');
    if (pageInfo) pageInfo.textContent = `Showing ${totalCount > 0 ? startIdx + 1 : 0} to ${endIdx} of ${totalCount} claims`;
    if (pageLabel) pageLabel.textContent = `Page ${this.currentPage} of ${maxPage}`;

    if (pageItems.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2.5rem; color:var(--text-muted); font-size:0.85rem;">No claims match the active filter criteria.</td></tr>`;
      return;
    }

    pageItems.forEach(c => {
      const evalRes = dataManager.getEvaluation(c.claim_id);
      const failed = evalRes.filter(r => r.status === 'FAIL');
      const uncertain = evalRes.filter(r => r.status === 'UNABLE_TO_ASSESS');

      let statusBadge = `<span class="chip chip-pass">PASS</span>`;
      if (failed.length > 0) {
        statusBadge = `<span class="chip chip-fail">${failed.length} FAIL</span>`;
      } else if (uncertain.length > 0) {
        statusBadge = `<span class="chip chip-warn">${uncertain.length} UNCERTAIN</span>`;
      }

      const row = document.createElement('tr');
      if (c.claim_id === this.selectedClaimId) row.classList.add('row-selected');

      row.innerHTML = `
        <td class="mono" style="font-weight:700; color:var(--text-primary);">${c.claim_id}</td>
        <td>${c.patient_id}</td>
        <td><span class="chip chip-brand" style="font-size:0.66rem;">${c.policy_id || 'UNKNOWN'}</span></td>
        <td style="color:var(--text-primary); font-weight:600;">${c.lines?.length || 0}</td>
        <td class="mono" style="font-weight:600; color:var(--text-primary);">${Number(c.total_amount || 0).toFixed(2)} SAR</td>
        <td>${statusBadge}</td>
        <td>
          <button class="btn btn-ghost btn-sm">
            Inspect &rarr;
          </button>
        </td>
      `;

      row.addEventListener('click', () => {
        this.selectedClaimId = c.claim_id;
        this.switchView('inspector');
      });

      tableBody.appendChild(row);
    });
  }

  renderInspector() {
    if (!this.selectedClaimId) return;
    const claim = dataManager.getClaim(this.selectedClaimId);
    if (!claim) return;

    const evalResults = dataManager.getEvaluation(this.selectedClaimId);

    // Left Panel: Claim Header & Metadata
    document.getElementById('insp-claim-id').textContent = claim.claim_id;
    document.getElementById('insp-invoice').textContent = claim.invoice_number || '—';
    document.getElementById('insp-patient-id').textContent = claim.patient_id || '—';
    document.getElementById('insp-member-id').textContent = claim.member_id || '—';
    document.getElementById('insp-provider-id').textContent = claim.provider_id || '—';
    document.getElementById('insp-policy-id').textContent = claim.policy_id || '—';
    document.getElementById('insp-sub-date').textContent = claim.submission_date || '—';
    document.getElementById('insp-diagnosis').textContent = claim.diagnosis_code || '—';
    document.getElementById('insp-total').textContent = `${Number(claim.total_amount || 0).toFixed(2)} SAR`;

    // Coverage card
    const cv = claim.coverage || {};
    document.getElementById('insp-cov-status').textContent = cv.status || 'N/A';
    document.getElementById('insp-cov-period').textContent = `${cv.start_date || 'N/A'} to ${cv.end_date || 'N/A'}`;
    document.getElementById('insp-cov-beneficiary').textContent = cv.beneficiary_patient_id || 'N/A';

    // Lines table
    const linesBody = document.getElementById('insp-lines-table-body');
    linesBody.innerHTML = '';
    (claim.lines || []).forEach((l, idx) => {
      const row = document.createElement('tr');
      row.id = `insp-line-row-${idx}`;
      row.innerHTML = `
        <td style="font-family:var(--font-mono); font-weight:700;">${l.line_id || idx + 1}</td>
        <td><span class="rule-tag-pill">${l.service_code || '—'}</span></td>
        <td class="cell-service-date">${l.service_date || '—'}</td>
        <td class="cell-quantity">${l.quantity !== null && l.quantity !== undefined ? l.quantity : '—'}</td>
        <td class="cell-unit-price">${l.unit_price !== null && l.unit_price !== undefined ? Number(l.unit_price).toFixed(2) : '—'}</td>
        <td class="cell-net-amount" style="font-family:var(--font-mono); font-weight:700;">${l.net_amount !== null && l.net_amount !== undefined ? Number(l.net_amount).toFixed(2) : '—'}</td>
        <td>${l.authorization_id || '—'}</td>
      `;
      linesBody.appendChild(row);
    });

    // Attachments & Notes (Prompt Injection Shield Check)
    const attContainer = document.getElementById('insp-attachments-container');
    attContainer.innerHTML = '';
    if (claim.attachments && claim.attachments.length > 0) {
      claim.attachments.forEach(att => {
        const check = copilotInstance.sanitizeClinicalNotes(att.text);
        const card = document.createElement('div');
        card.style.background = 'var(--bg-input)';
        card.style.border = '1px solid var(--border-light)';
        card.style.borderRadius = 'var(--radius-sm)';
        card.style.padding = '0.75rem';
        card.style.marginTop = '0.5rem';
        card.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
            <strong style="font-size:0.78rem; color:var(--text-primary);">📎 ${att.document_type || att.type || 'Document'} (${att.document_status || 'unknown'})</strong>
            ${check.suspicious ? '<span class="chip chip-fail">🛡️ Prompt Injection Shielded</span>' : '<span class="chip chip-pass">Verified Safe</span>'}
          </div>
          <p style="font-size:0.75rem; color:var(--text-secondary); background:rgba(0,0,0,0.25); padding:0.5rem; border-radius:4px; font-family:var(--font-mono);">
            ${att.text || 'No unstructured text provided.'}
          </p>
          ${check.shieldNote ? `<div style="color:var(--status-fail); font-size:0.72rem; margin-top:0.35rem; font-weight:600;">${check.shieldNote}</div>` : ''}
        `;
        attContainer.appendChild(card);
      });
    } else {
      attContainer.innerHTML = `<span style="font-size:0.78rem; color:var(--text-muted);">No documents attached to this claim.</span>`;
    }

    // Right Panel: 15-Rule Validation Checklist
    const rulesList = document.getElementById('insp-rules-checklist');
    rulesList.innerHTML = '';

    evalResults.forEach(r => {
      const card = document.createElement('div');
      let tileClass = 'rule-tile';
      if (r.status === 'FAIL') tileClass += ' tile-fail';
      else if (r.status === 'UNABLE_TO_ASSESS') tileClass += ' tile-warn';
      else if (r.status === 'PASS') tileClass += ' tile-pass';
      card.className = tileClass;

      let chipClass = 'chip-pass';
      if (r.status === 'FAIL') chipClass = 'chip-fail';
      else if (r.status === 'UNABLE_TO_ASSESS') chipClass = 'chip-warn';
      else if (r.status === 'NOT_APPLICABLE') chipClass = 'chip-na';

      const isOpen = r.status === 'FAIL' || r.status === 'UNABLE_TO_ASSESS';

      card.innerHTML = `
        <div class="rule-tile-head">
          <div class="rule-tile-head-left">
            <span class="rule-pill">${r.rule_id}</span>
            <span class="rule-title">${r.title}</span>
          </div>
          <div style="display:flex; align-items:center; gap:0.5rem; flex-shrink:0;">
            <span class="chip ${chipClass}">${r.status}</span>
            <span style="color:var(--text-muted); font-size:0.65rem; transform:${isOpen?'rotate(180deg)':'rotate(0)'}; transition:transform 0.2s; display:inline-block;">▼</span>
          </div>
        </div>
        <div class="rule-tile-body${isOpen ? ' open' : ''}">
          <p style="color:var(--text-primary); font-weight:500; margin-bottom:0.5rem;">${r.explanation}</p>
          ${r.corrective_action ? `<p style="color:var(--warn); font-size:0.76rem; margin-bottom:0.4rem;"><strong>Action:</strong> ${r.corrective_action}</p>` : ''}
          ${r.evidence && r.evidence.length > 0 ? `
            <div style="margin-top:0.4rem;">
              <span style="font-size:0.67rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:0.06em;">Observed Evidence:</span><br>
              ${r.evidence.map(ev => `<span class="evidence-tag">${ev.path}</span> = <code style="font-family:var(--font-mono); font-size:0.72rem; color:var(--text-primary);">${JSON.stringify(ev.value)}</code>`).join('<br>')}
            </div>
          ` : ''}
        </div>
      `;

      card.querySelector('.rule-tile-head').addEventListener('click', () => {
        const body = card.querySelector('.rule-tile-body');
        const arrow = card.querySelector('.rule-tile-head span:last-child');
        body.classList.toggle('open');
        if (arrow) arrow.style.transform = body.classList.contains('open') ? 'rotate(180deg)' : 'rotate(0)';
      });

      rulesList.appendChild(card);
    });

    // Bounded AI Copilot Summary
    const aiBox = document.getElementById('ai-copilot-summary-box');
    const aiRes = copilotInstance.generateExplanation(claim, evalResults);
    aiBox.innerHTML = `
      <div class="ai-head">
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span style="font-size:1rem;">🤖</span>
          <strong style="font-size:0.82rem; color:var(--text-primary);">Bounded Copilot Synthesis</strong>
        </div>
        <span class="ai-model-badge">${aiRes.model}</span>
      </div>
      <p class="ai-summary-text">${aiRes.summary}</p>
      ${aiRes.cited_evidence_paths.length > 0 ? `
        <div style="margin-top:0.5rem;">
          <span style="font-size:0.65rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:0.08em;">Grounded Evidence Citations:</span><br>
          ${aiRes.cited_evidence_paths.map(p => `<button class="citation-btn" data-path="${p}">📌 ${p}</button>`).join('')}
        </div>
      ` : ''}
      <div style="font-size:0.67rem; color:var(--text-muted); margin-top:0.625rem; border-top:1px solid var(--border-faint); padding-top:0.4rem;">
        ${aiRes.disclaimer}
      </div>
    `;

    // Bind citation buttons to highlight line items
    aiBox.querySelectorAll('.citation-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const path = btn.dataset.path;
        this.highlightEvidenceCell(path);
      });
    });
  }

  highlightEvidenceCell(path) {
    // e.g. /lines/0/net_amount
    const match = /^\/lines\/(\d+)\/(\w+)$/.exec(path);
    if (match) {
      const lineIdx = match[1];
      const field = match[2];
      const row = document.getElementById(`insp-line-row-${lineIdx}`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const cell = row.querySelector(`.cell-${field.replace('_', '-')}`);
        if (cell) {
          cell.classList.add('hl-fail');
          setTimeout(() => cell.classList.remove('hl-fail'), 2500);
        }
      }
    }
  }

  async handleReviewAction(actionType) {
    if (!this.selectedClaimId) return;
    const claim = dataManager.getClaim(this.selectedClaimId);
    
    await globalAudit.logEvent(actionType, {
      claim_id: claim.claim_id,
      timestamp: new Date().toISOString(),
      action: actionType
    }, 'OFFICER_REVIEWER');

    alert(`Action [${actionType}] recorded to cryptographic audit chain.`);
    this.renderAuditTimeline();
  }

  openRequestInfoModal() {
    const claim = dataManager.getClaim(this.selectedClaimId);
    if (!claim) return;

    const modal = document.getElementById('request-info-modal');
    const textarea = document.getElementById('request-email-draft');
    textarea.value = `Subject: Pre-Validation Inquiry - Claim ${claim.claim_id} (Invoice: ${claim.invoice_number})

Dear Clinical Billing Department,

During pre-validation checks with ClaimGuard AI, the following discrepancy requires clarification before payer submission:
- Claim ID: ${claim.claim_id}
- Patient ID: ${claim.patient_id}
- Declared Policy: ${claim.policy_id}
- Total Amount: ${claim.total_amount} SAR

Please supply finalized clinical documentation or updated authorization references.

Regards,
Claims Review Officer`;

    modal.classList.add('open');
    document.getElementById('close-request-modal').onclick = () => modal.classList.remove('open');
    document.getElementById('send-request-btn').onclick = async () => {
      await globalAudit.logEvent('REQUEST_INFORMATION', { claim_id: claim.claim_id, note: 'Documentation request dispatched' }, 'OFFICER_REVIEWER');
      modal.classList.remove('open');
      alert('Request dispatched and logged to audit blockchain.');
      this.renderAuditTimeline();
    };
  }

  openEditClaimModal() {
    const claim = dataManager.getClaim(this.selectedClaimId);
    if (!claim) return;

    const modal = document.getElementById('edit-claim-modal');
    const jsonEditor = document.getElementById('claim-json-editor');
    jsonEditor.value = JSON.stringify(claim, null, 2);

    modal.classList.add('open');
    document.getElementById('close-edit-modal').onclick = () => modal.classList.remove('open');
    document.getElementById('save-recheck-btn').onclick = async () => {
      try {
        const updated = JSON.parse(jsonEditor.value);
        dataManager.updateClaim(claim.claim_id, updated);
        await globalAudit.logEvent('EDIT_AND_RECHECK', { claim_id: claim.claim_id, updated_version: '2.0' }, 'OFFICER_REVIEWER');
        modal.classList.remove('open');
        this.updateAllViews();
        alert('Claim updated! 15 rules re-evaluated in real time.');
      } catch (e) {
        alert('Invalid JSON: ' + e.message);
      }
    };
  }

  async handleFileUpload(file) {
    if (!file) return;
    const text = await file.text();
    let claims = [];

    if (file.name.endsWith('.jsonl')) {
      claims = dataManager.parseJSONL(text);
    } else if (file.name.endsWith('.csv')) {
      claims = dataManager.parseCSV(text);
    } else if (file.name.endsWith('.json')) {
      try {
        const parsed = JSON.parse(text);
        if (parsed.resourceType === 'Claim') {
          claims = [dataManager.parseFHIRClaim(parsed)];
        } else if (Array.isArray(parsed)) {
          claims = parsed;
        } else {
          claims = [parsed];
        }
      } catch (e) {
        alert('JSON parse error: ' + e.message);
        return;
      }
    }

    if (claims.length > 0) {
      dataManager.loadClaims(claims, file.name);
      await globalAudit.logEvent('INGEST_CUSTOM_FILE', { file: file.name, count: claims.length });
      this.currentPage = 1;
      this.selectedClaimId = claims[0].claim_id;
      this.updateAllViews();
      this.switchView('queue');
      alert(`Successfully ingested & pre-validated ${claims.length} claims from ${file.name}!`);
    }
  }

  renderRulebook() {
    const container = document.getElementById('rulebook-reference-list');
    if (!container) return;

    container.innerHTML = '';
    RULES_CONFIG.forEach(r => {
      const card = document.createElement('div');
      card.className = 'rule-ref-card';
      card.innerHTML = `
        <div class="rule-ref-head">
          <span class="rule-pill">${r.rule_id}</span>
          <div style="display:flex; justify-content:space-between; align-items:center; flex:1; min-width:0;">
            <span class="rule-ref-title">${r.title}</span>
            <span class="chip ${r.severity === 'high' ? 'chip-fail' : 'chip-warn'}" style="flex-shrink:0;">${r.severity}</span>
          </div>
        </div>
        <p class="rule-ref-body" style="font-family:var(--font-mono); margin-bottom:0.4rem; font-size:0.72rem;">${r.source}</p>
        <p class="rule-ref-body"><strong style="color:var(--warn);">Action:</strong> ${r.corrective_action}</p>
      `;
      container.appendChild(card);
    });
  }

  renderAuditTimeline() {
    const container = document.getElementById('audit-timeline-container');
    if (!container) return;

    container.innerHTML = '';
    const entries = globalAudit.getRecentEntries(20);

    if (entries.length === 0) {
      container.innerHTML = `<div class="card" style="text-align:center; color:var(--text-muted); font-size:0.85rem; padding:2.5rem;">No audit events yet. Load a dataset to begin.</div>`;
      return;
    }

    entries.forEach((b, idx) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'audit-block';

      wrapper.innerHTML = `
        <div class="audit-connector">
          <div class="audit-dot"></div>
          ${idx < entries.length - 1 ? '<div class="audit-line"></div>' : ''}
        </div>
        <div class="audit-body">
          <div class="audit-header">
            <span class="audit-type">BLOCK #${b.index} &nbsp;·&nbsp; <span style="color:var(--indigo-400);">[${b.action}]</span></span>
            <span class="audit-time">${b.timestamp}</span>
          </div>
          <div style="font-size:0.76rem; color:var(--text-secondary); display:flex; gap:1.25rem; flex-wrap:wrap;">
            <span>Actor: <strong style="color:var(--text-primary);">${b.reviewerId || 'SYSTEM'}</strong></span>
            <span>Data: <code style="font-family:var(--font-mono); font-size:0.7rem; color:var(--text-secondary);">${JSON.stringify(b.data || {}).substring(0, 60)}…</code></span>
          </div>
          <div class="audit-hash">Prev: ${b.prevHash.substring(0, 32)}…&nbsp;&nbsp;|&nbsp;&nbsp;Hash: <span style="color:var(--pass);">${b.hash.substring(0, 32)}…</span></div>
        </div>
      `;
      container.appendChild(wrapper);
    });
  }
}

// Initialize Application on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new ClaimGuardApp();
});
