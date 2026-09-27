/**
 * ClaimGuard AI — Cryptographic Audit Trail (SHA-256 Hash Chain)
 * Provides tamper-evident logging of claim ingestions, rule evaluations, and officer actions.
 */

async function sha256(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export class AuditLog {
  constructor() {
    this.chain = [];
    this.init();
  }

  async init() {
    if (this.chain.length === 0) {
      const genesisPayload = {
        index: 0,
        timestamp: new Date().toISOString(),
        action: "GENESIS",
        details: "ClaimGuard AI Audit Chain Initialized",
        prevHash: "0000000000000000000000000000000000000000000000000000000000000000"
      };
      const hash = await sha256(JSON.stringify(genesisPayload));
      this.chain.push({ ...genesisPayload, hash });
    }
  }

  async logEvent(action, payload, reviewerId = "SYSTEM") {
    const prevBlock = this.chain[this.chain.length - 1];
    const prevHash = prevBlock ? prevBlock.hash : "0".repeat(64);
    
    const blockData = {
      index: this.chain.length,
      timestamp: new Date().toISOString(),
      action: action,
      reviewerId: reviewerId,
      payload: payload,
      prevHash: prevHash
    };

    const hash = await sha256(JSON.stringify(blockData));
    const block = { ...blockData, hash };
    this.chain.push(block);
    return block;
  }

  async verifyChain() {
    if (this.chain.length === 0) return { valid: true, error: null };

    for (let i = 1; i < this.chain.length; i++) {
      const current = this.chain[i];
      const prev = this.chain[i - 1];

      if (current.prevHash !== prev.hash) {
        return {
          valid: false,
          error: `Broken link at Block #${current.index}: prevHash does not match Block #${prev.index} hash.`
        };
      }

      const { hash, ...dataToHash } = current;
      const calculatedHash = await sha256(JSON.stringify(dataToHash));
      if (calculatedHash !== hash) {
        return {
          valid: false,
          error: `Tampering detected at Block #${current.index}: payload content does not match signature hash.`
        };
      }
    }

    return { valid: true, totalBlocks: this.chain.length };
  }

  getEntriesForClaim(claimId) {
    return this.chain.filter(b => b.payload && b.payload.claim_id === claimId);
  }

  getRecentEntries(limit = 20) {
    return [...this.chain].reverse().slice(0, limit);
  }
}

export const globalAudit = new AuditLog();
