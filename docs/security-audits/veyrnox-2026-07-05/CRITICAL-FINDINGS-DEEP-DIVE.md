# VEYRNOX Critical Findings: Deep-Dive Analysis
**Date**: 2026-07-05  
**Purpose**: Detailed remediation guidance for blockers before mainnet  
**Audience**: Security team, DevOps, Engineering leads

---

## Finding #1: CI Invariant Enforcement is INACTIVE

### 🔴 SEVERITY: CRITICAL | MAINNET BLOCKER: YES

### Executive Summary
The VEYRNOX security model depends on architectural invariants enforced at build-time:
- **I1-I5**: Five non-negotiable security properties
- **R0/R1**: Ring boundary (crypto-core isolation)

**Problem**: These invariants are documented but NOT enforced by CI. A developer could accidentally:
1. Import vault/signing logic into UI code (violates R1)
2. Expose keys in logs (violates I1)
3. Make backend calls during duress (violates I3)

**Current State**: ESLint rule was never written; structural lint is inert.

---

### Root Cause Analysis

#### The ESLint Bug
```javascript
// .eslintrc.js (BROKEN)
export default [
  js.configs.recommended,
  {
    rules: {
      ...js.configs.recommended.rules,  // ← PROBLEM: spread overwrites
      'no-restricted-imports': {        // ← Custom rule defined
        patterns: ['@vault/*', '@signing/*']
      }
    }
  }
]

// Result: js.configs.recommended.rules is OVERWRITTEN, not merged
// The spread operator in rules:{} silently loses the recommended config
```

#### Why This Happened
1. ESLint v9 changed config format (flat config system)
2. Migration from old format may have introduced the bug
3. No CI gate verified the rule was actually working
4. Tests may pass even if lint enforcement is broken

#### Impact Assessment
- **Probability of Violation**: Medium (accidental R1 import possible during refactor)
- **Detection**: Zero (no CI gate; violation slips through)
- **Consequence**: HIGH
  - Crypto core exposed to UI layer
  - Potential for keys to leak into logs
  - Deniability stack compromise if egress logic imported into duress mode

---

### Remediation: Step-by-Step Fix

#### Step 1: Verify Current ESLint Configuration
```bash
# Run ESLint with --print-config to see actual resolved config
npx eslint --print-config src/vault.js | grep -A5 "no-restricted-imports"

# Expected output should show:
# - no-restricted-imports rule is ACTIVE
# - Patterns include: @vault, @signing, @keys, etc.

# If rule is missing or disabled, the bug is confirmed
```

**Verification Test**:
```javascript
// src/test-forbidden-import.js (INTENTIONAL VIOLATION)
import { deserializeVault } from '@vault/deserialize'; // ← Should be caught

// Run: npx eslint src/test-forbidden-import.js
// Expected: Error message flagging forbidden import
// If no error: Bug is confirmed; config is broken
```

#### Step 2: Fix the ESLint Configuration
```javascript
// ✅ CORRECT: Flat config with proper rule merging
export default [
  js.configs.recommended,
  {
    rules: {
      // ✅ OPTION 1: Override specific rules only
      'no-console': 'warn',
      'no-unused-vars': 'off',
      
      // ✅ OPTION 2: Add custom rules without overwriting
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            // Crypto core (R0/R1) cannot be imported by UI/backend
            '@vault/*',           // Vault encryption/decryption
            '@signing/*',         // Key signing operations
            '@keys/*',            // Key material handling
            
            // Backend-critical logic cannot be imported by deniability code
            '@backend/*',         // API communication
            '@analytics/*',       // Telemetry (violates I2)
          ],
          importNames: [
            'serializeVault',     // Specific functions
            'deserializeVault',
            'signTransaction',
          ],
        }
      ]
    }
  }
]

// ✅ Alternative: Use ESLint Flat Config Merge Plugin
// npm install @eslint/eslintrc
import { FlatCompat } from "@eslint/eslintrc";
const compat = new FlatCompat();
export default [
  ...compat.extends("eslint:recommended"),
  {
    rules: {
      // Overrides here won't overwrite recommended
    }
  }
]
```

#### Step 3: Implement R0/R1 Ring-Import Rule
```javascript
// eslint/rules/ring-import-lint.js
// CUSTOM RULE: Enforce ring boundaries

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce R0/R1 crypto-core ring isolation',
      category: 'Security',
      recommended: true
    },
    fixable: null,
    schema: []
  },
  
  create(context) {
    const R0_R1_MODULES = [
      '@vault',      // R0: Hardware keystore, vault operations
      '@signing',    // R1: Signing logic
      '@keys',       // R1: Key material
      '@crypto'      // R1: Cryptographic operations
    ];
    
    const FORBIDDEN_IMPORTERS = [
      /src\/(ui|routes|pages)\//,      // UI layer (R4)
      /src\/(backend|api|client)\//,   // Backend client (R2)
      /src\/(state|provider)\//        // App state (R3)
    ];
    
    return {
      ImportDeclaration(node) {
        const importSource = node.source.value;
        const fileName = context.filename;
        
        // Check if this import violates ring boundaries
        const isR0R1Import = R0_R1_MODULES.some(m => importSource.includes(m));
        const isFromForbiddenLayer = FORBIDDEN_IMPORTERS.some(r => r.test(fileName));
        
        if (isR0R1Import && isFromForbiddenLayer) {
          context.report({
            node,
            message: `Ring boundary violation: R0/R1 crypto-core (${importSource}) cannot be imported from UI/backend (${fileName}). This violates the deniability stack isolation.`,
            fix: null // No auto-fix; developer must refactor
          });
        }
      }
    };
  }
};

// .eslintrc.js - Enable the rule
export default [
  js.configs.recommended,
  {
    plugins: {
      'ring-import': require('./eslint/rules/ring-import-lint.js')
    },
    rules: {
      'ring-import/ring-import-lint': 'error'
    }
  }
]
```

#### Step 4: Add CI Gate Validation
```yaml
# .github/workflows/verify.yml
name: Verify

on: [pull_request]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      
      - name: Install dependencies
        run: npm install
      
      # NEW: Verify ESLint rule is active
      - name: Validate ESLint Configuration
        run: |
          # Check if no-restricted-imports rule is active
          npx eslint --print-config src/vault.js | grep -q "no-restricted-imports" || {
            echo "❌ CRITICAL: no-restricted-imports rule is not active!"
            echo "The ESLint configuration may be broken."
            exit 1
          }
          echo "✅ ESLint rule validation passed"
      
      # NEW: Test the ring-import-lint rule
      - name: Test Ring Import Lint Rule
        run: |
          # Create intentional violation to verify rule catches it
          echo "import { deserializeVault } from '@vault/deserialize'; // VIOLATION" > /tmp/test-violation.js
          npx eslint /tmp/test-violation.js 2>&1 | grep -q "ring boundary" || {
            echo "❌ CRITICAL: Ring import lint rule is not working!"
            exit 1
          }
          echo "✅ Ring import lint rule is active and working"
      
      # EXISTING: Run main lint
      - name: Run ESLint
        run: npx eslint . --max-warnings=0
      
      # EXISTING: Run tests
      - name: Run Tests
        run: npm test
      
      - name: Build (verify no CI bypass)
        run: npm run build
```

#### Step 5: Create Verification Test Suite
```javascript
// tests/lint/ring-boundaries.test.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('Ring Boundary Enforcement', () => {
  test('ESLint rule detects vault import in UI code', () => {
    const testFile = path.join(__dirname, 'fixtures', 'forbidden-vault-import.js');
    
    // Create test file with violation
    fs.writeFileSync(testFile, `
      import { deserializeVault } from '@vault/deserialize';
      // This is UI code (R4) importing R1 code - should fail
      export function MyComponent() {
        return <div>...</div>;
      }
    `);
    
    // Run ESLint
    const result = execSync(`npx eslint ${testFile}`, { encoding: 'utf8', stdio: 'pipe' });
    
    // Verify rule caught the violation
    expect(result).toContain('ring boundary violation');
    
    // Cleanup
    fs.unlinkSync(testFile);
  });
  
  test('ESLint rule allows vault import in vault module', () => {
    const testFile = path.join(__dirname, 'fixtures', 'allowed-vault-import.js');
    
    // Create test file with allowed import
    fs.writeFileSync(testFile, `
      import { serializeVault } from '@vault/serialize';
      // This is vault code (R0) - should pass
      export function encryptVault(data) {
        return serializeVault(data);
      }
    `);
    
    // Run ESLint (should not report error)
    const result = execSync(`npx eslint ${testFile} 2>&1 || true`, { encoding: 'utf8' });
    
    // Verify no ring boundary violation
    expect(result).not.toContain('ring boundary violation');
    
    // Cleanup
    fs.unlinkSync(testFile);
  });
  
  test('Config validation: no-restricted-imports is active', () => {
    const result = execSync('npx eslint --print-config src/vault.js 2>&1', { encoding: 'utf8' });
    expect(result).toContain('no-restricted-imports');
  });
});
```

#### Step 6: Documentation & Enforcement
```markdown
## Ring Boundary Enforcement Policy

### Why This Matters
The deniability stack depends on strict isolation:
- **R0**: Hardware keystore (Capacitor native)
- **R1**: Cryptographic core (vault, signing, keys)
- **R2**: Vault/MultiVault (encrypted storage)
- **R3**: App state (WalletProvider)
- **R4**: UI (React components)

**Rule**: R0/R1 can NEVER be imported by R2/R3/R4.

### How to Verify
```bash
# Before committing:
npx eslint . --fix  # Auto-fix what can be fixed
npm test            # Run ring-boundary tests
npm run build       # Build should pass CI gate
```

### If You Need to Import Vault Logic into UI
❌ **WRONG**: Direct import
```javascript
// ❌ VIOLATION: This will fail CI
import { deserializeVault } from '@vault/deserialize';
```

✅ **RIGHT**: Create abstraction layer in R2/R3
```javascript
// ✅ CORRECT: Abstract vault operations through WalletProvider
// src/state/WalletProvider.jsx
export const WalletContext = createContext();
export function useWallet() {
  return useContext(WalletContext);
  // Vault operations are hidden inside provider
}

// src/ui/Dashboard.jsx
function Dashboard() {
  const { balance } = useWallet();  // No direct vault import
  return <div>{balance}</div>;
}
```
```

---

### Implementation Timeline
- **Day 1**: Identify and fix ESLint config bug
- **Day 2**: Implement ring-import-lint rule
- **Day 3**: Add CI gate validation + test suite
- **Day 4**: Run against entire codebase; fix any violations
- **Day 5**: Merge and validate in CI

**Total Effort**: 4-5 days  
**Risk if Skipped**: CRITICAL (no build-time protection of crypto boundaries)

---

## Finding #2: Crypto Implementation Divergence from Design

### 🔴 SEVERITY: HIGH | MAINNET BLOCKER: YES

### Executive Summary

**Design Spec** claimed:
- Argon2id (m=192/t=3)
- XChaCha20-Poly1305 cipher
- HKDF three-step key derivation

**Verified Implementation** actually uses:
- Argon2id via hash-wasm
- **AES-256-GCM** cipher (NOT XChaCha20)
- **No HKDF** step (direct Argon2id → cipher)

**Problem**: Design ≠ Implementation. Need to verify the actual choice is secure and well-justified.

---

### Detailed Comparison

#### Key Derivation Pipeline

**Design Specification**:
```
Unlock PIN (user input)
    ↓
Argon2id (m=192 MB, t=3 iterations)
    ↓ (32-byte output)
HKDF-Expand (expand to cipher key + IV)
    ↓
XChaCha20-Poly1305
    ↓
Encrypted Vault Blob
```

**Verified Implementation**:
```
Unlock PIN (user input)
    ↓
Argon2id via hash-wasm (m=??? t=???)  ← UNVERIFIED: Memory/time settings
    ↓
WebCrypto AES-256-GCM (direct feed)   ← DIVERGENCE: No HKDF step
    ↓
Encrypted Vault Blob
```

#### Cipher Comparison: XChaCha20-Poly1305 vs AES-256-GCM

| Property | XChaCha20-Poly1305 | AES-256-GCM |
|----------|-------------------|------------|
| **Type** | AEAD stream cipher | AEAD block cipher |
| **Key Size** | 256 bits | 256 bits |
| **Nonce Size** | 192 bits (can use random) | 96 bits (recommend random) |
| **Side-Channel Resistance** | Constant-time (high) | Timing-resistant implementations exist; some implementations vulnerable |
| **Hardware Acceleration** | Not widely available | Available on modern CPUs (AES-NI) |
| **NIST Approval** | No (independent standard) | Yes (NIST approved) |
| **Cryptographic Community** | Favored by privacy-conscious (Signal, WireGuard) | Standard choice (TLS 1.3, most protocols) |
| **WebCrypto Support** | No native support | Yes, directly in WebCrypto |

**Implication**: 
- XChaCha20-Poly1305 chosen for **constant-time properties** (side-channel resistance)
- AES-256-GCM is standard but **may have timing-variant implementations**
- Privacy/security trade-off: Theoretical vs. Practical

---

### Required Cryptographic Review

#### Audit Checklist

**1. WebCrypto AES-256-GCM Implementation**
```
REQUIRED REVIEW:
- [ ] Verify WebCrypto AES-256-GCM is NIST SP 800-38D compliant
  Source: browser AES-GCM implementation (spec: crypto.subtle.encrypt('AES-GCM', ...))
  
- [ ] Check browser support for WebCrypto AES-256-GCM
  Chrome: ✅ (v37+)
  Firefox: ✅ (v34+)
  Safari: ✅ (v11+)
  
- [ ] Verify IV/nonce generation is cryptographically random
  Expected: crypto.getRandomValues(new Uint8Array(12)) for 96-bit nonce
  Risk if wrong: IV reuse = GCM breaks down, authentication fails
  
- [ ] Check authentication tag validation
  Expected: Tag length = 16 bytes (128 bits)
  Risk if wrong: Weak authentication tag = forgery attacks
  
- [ ] Verify no truncation of IV/tag/ciphertext
  Risk: Silent truncation = decryption succeeds but ciphertext corrupted

- [ ] Test: Decrypt with wrong authentication tag
  Expected: Decryption fails with "Authentication failed" or similar
  Risk if wrong: Weak authentication = accepting tampered ciphertext
```

**2. Argon2id Parameters Verification**
```
REQUIRED REVIEW:
- [ ] Verify Argon2id memory setting (m=???)
  Design spec: m=192 MB
  Implementation: [Document actual value]
  
- [ ] Verify Argon2id time cost (t=???)
  Design spec: t=3
  Implementation: [Document actual value]
  
- [ ] Verify parallelism parameter (p=???)
  Design spec: [Not mentioned; likely 4]
  Implementation: [Document actual value]
  
- [ ] Compare against OWASP recommendations (2023)
  OWASP: m=19 MB (minimum), t=2 (minimum)
  Veyrnox: [Check if meets or exceeds]
  
- [ ] Verify salt is cryptographically random
  Expected: 32 bytes of random data (256 bits)
  Risk if wrong: Weak salt = rainbow tables
  
- [ ] Test: Hash same PIN twice
  Expected: Different hash (salt is random each time)
  Risk if wrong: Deterministic hashing = pre-computed tables
```

**3. KDF Pipeline Security**
```
CRITICAL DIVERGENCE REVIEW:

Design claimed HKDF step:
  Argon2id (pseudo-random) → HKDF (key derivation) → Cipher Key

Implementation skips HKDF:
  Argon2id (pseudo-random) → Cipher Key (direct feed)

REQUIRED ANALYSIS:
- [ ] Why was HKDF removed?
  Justification: [Document rationale]
  Risk: None if Argon2id output is directly usable as cipher key
  
- [ ] Is Argon2id output suitable for direct use as AES key?
  Argon2id output: 32 bytes of pseudo-random
  AES-256-GCM key: 32 bytes required
  Answer: YES, length matches. Is entropy high enough?
  
- [ ] Verify Argon2id output has ≥256 bits of entropy
  Expected: NIST SP 800-132 compliance
  Risk if wrong: Weak entropy = key space reduced
  
- [ ] Alternative: Is HKDF required for security?
  Argon2id already does key stretching
  HKDF usually needed when input has unknown entropy
  Analysis: Direct feed may be acceptable IF Argon2id is properly configured
```

**4. Side-Channel Resistance**
```
CRITICAL REVIEW:

WebCrypto AES-256-GCM Side-Channel Risks:
- [ ] Verify browser implementation uses constant-time AES
  Check: Modern browsers (post-2015) use hardware AES-NI or CLMUL
  Risk: Older implementations may have timing attacks
  
- [ ] Verify GCM authentication is constant-time
  Risk: Some GCM implementations leak authentication success/failure timing
  
- [ ] Compare timing properties vs XChaCha20-Poly1305
  XChaCha20: Always constant-time (stream cipher)
  AES-GCM: Usually constant-time but implementation-dependent
  
- [ ] Assess threat model
  T6 (Rooted OS): App-layer crypto timing doesn't matter (JS heap readable)
  Design discloses this limit honestly
  Conclusion: Acceptable for threat model
```

---

### Risk Mitigation Options

#### Option A: Accept AES-256-GCM (RECOMMENDED)
**Justification**:
- NIST-standard algorithm
- WebCrypto native support (browser-provided)
- Suitable for self-custody wallet (T6 threat already accepted)
- Implementation auditable via browser APIs

**Conditions**:
1. Cryptographer review confirms WebCrypto impl is NIST-compliant
2. Argon2id parameters meet OWASP standards
3. Documentation updated to reflect actual cipher choice
4. No marketing claims about XChaCha20 (reflect actual crypto)

#### Option B: Revert to XChaCha20-Poly1305 (HIGHER EFFORT)
**Justification**:
- Original design intent (side-channel resistance)
- Better privacy-focused reputation

**Cost**:
- Lose WebCrypto native support
- Require @noble or libsodium.js library
- Add ~50KB to bundle
- Requires key derivation design review

**Timeline**: +1 week

---

### Recommended Audit Scope

**Phase 1: Cryptographer Review (1 week)**
- [ ] WebCrypto AES-256-GCM security properties
- [ ] Argon2id parameter validation
- [ ] KDF pipeline without HKDF (is it secure?)
- [ ] Side-channel analysis
- **Deliverable**: Go/No-go decision on AES-256-GCM

**Phase 2: Implementation Verification (3 days)**
- [ ] Code review of key derivation logic
- [ ] Unit tests for encryption/decryption
- [ ] Failure mode testing (wrong PIN, corrupted ciphertext)
- **Deliverable**: Confirmed implementation matches review findings

**Phase 3: Documentation Update (2 days)**
- [ ] Update LLD to reflect actual cipher choice
- [ ] Document cryptographic rationale
- [ ] Add cryptographer sign-off
- **Deliverable**: Revised security architecture

---

## Finding #3: Mainnet Deployment Gate - Manual & Unguarded

### 🔴 SEVERITY: HIGH | MAINNET BLOCKER: YES

### Executive Summary

**Current Mainnet Activation Process**:
1. Configs in `networks.js` are enabled
2. All assets point to testnet in `assets.js`
3. To activate mainnet: Edit `assets.js` and flip chain-key from testnet → mainnet
4. No code gate, no approval, no audit trail
5. **Risk**: Accidental or unauthorized mainnet activation

**Problem**: Single point of failure (manual edit). No CI protection, no multi-step approval.

---

### Detailed Threat Analysis

#### Scenario 1: Accidental Mainnet Activation
```
Sequence:
1. Developer edits assets.js during refactor
2. Creates PR with mainnet-pointing key (by accident)
3. CI passes (no gate checks chain-key)
4. PR merged to main
5. Next build uses mainnet key
6. App deployed; real funds now on mainnet (unintended)
7. Funds vulnerable (no audit completed yet)

Probability: MEDIUM (easy to accidentally edit key)
Detection: ZERO (no CI gate)
Impact: CRITICAL (premature mainnet activation, fund loss risk)
```

#### Scenario 2: Unauthorized Mainnet Activation
```
Sequence:
1. Malicious insider edits assets.js
2. Flips mainnet key for one asset
3. Submits innocent-looking PR ("Refactor asset config")
4. CI doesn't catch key change (no gate)
5. PR merged; deployed
6. Asset now on mainnet with compromised chain key
7. Attacker drains funds

Probability: LOW (insider threat)
Detection: ZERO (no CI gate)
Impact: CRITICAL (fund loss, security breach)
```

#### Scenario 3: Audit-Phase Mainnet Flip
```
Sequence:
1. Audit underway on testnet
2. Impatient stakeholder flips mainnet key
3. Audit incomplete; real funds deployed
4. Auditor discovers vulnerability post-activation
5. Funds already at risk

Probability: MEDIUM (pressure to launch)
Detection: ZERO (manual process, no approval gate)
Impact: CRITICAL (vulnerability exposure before audit complete)
```

---

### Recommended Remediation

#### Step 1: Implement Mainnet Chain-Key Validation Gate
```javascript
// scripts/validate-mainnet-keys.js
const fs = require('fs');
const path = require('path');

const TESTNET_KEYS = {
  ETH: 'sepolia',
  POLYGON: 'amoy',
  ARBITRUM: 'arbitrum-sepolia',
  OPTIMISM: 'optimism-sepolia',
  BITCOIN: 'bitcoin-testnet',
  SOLANA: 'devnet',
  AVALANCHE: 'fuji',
  BNB: 'bsc-testnet',
};

const MAINNET_KEYS = {
  ETH: 'ethereum',
  POLYGON: 'polygon',
  ARBITRUM: 'arbitrum-one',
  OPTIMISM: 'optimism',
  BITCOIN: 'bitcoin',
  SOLANA: 'mainnet-beta',
  AVALANCHE: 'avalanche',
  BNB: 'bsc',
};

function validateAssets() {
  const assetsFile = path.join(__dirname, '../src/config/assets.js');
  const content = fs.readFileSync(assetsFile, 'utf8');
  
  // Parse assets config
  const hasMainnetKeys = Object.values(MAINNET_KEYS).some(key => content.includes(key));
  
  if (hasMainnetKeys) {
    console.error('❌ CRITICAL: Mainnet chain-keys detected in assets.js!');
    console.error('This requires explicit audit approval before deployment.');
    console.error('\nTo activate mainnet:');
    console.error('1. Ensure independent audit is COMPLETE');
    console.error('2. Obtain audit sign-off (saved in audit/ directory)');
    console.error('3. Create git tag: release-mainnet-ASSET-DATE');
    console.error('4. Build with MAINNET_APPROVED=1 flag');
    process.exit(1);
  }
  
  console.log('✅ Mainnet validation passed: All assets on testnet');
}

validateAssets();
```

**Integration in CI**:
```yaml
# .github/workflows/verify.yml
- name: Validate Mainnet Keys
  run: node scripts/validate-mainnet-keys.js
```

#### Step 2: Implement Multi-Step Approval Process
```javascript
// scripts/activate-mainnet.js
const fs = require('fs');
const path = require('path');
const execSync = require('child_process').execSync;

const REQUIRED_FILES = [
  'audit/audit-sign-off.txt',      // Audit completion proof
  'audit/cryptographer-sign-off.txt', // Crypto verification
  'audit/penetration-test-results.md', // Pentest results
];

function activateMainnet(asset) {
  console.log(`\n🚨 Mainnet Activation for ${asset}\n`);
  
  // Step 1: Verify audit artifacts exist
  console.log('Step 1: Checking audit artifacts...');
  const missingArtifacts = REQUIRED_FILES.filter(f => !fs.existsSync(f));
  if (missingArtifacts.length > 0) {
    console.error('❌ Missing audit artifacts:');
    missingArtifacts.forEach(f => console.error(`  - ${f}`));
    console.error('\nAudit must be COMPLETE before mainnet activation.');
    process.exit(1);
  }
  console.log('✅ All audit artifacts present');
  
  // Step 2: Verify current git branch is clean
  console.log('\nStep 2: Verifying git state...');
  try {
    execSync('git diff --exit-code', { stdio: 'pipe' });
    execSync('git diff --cached --exit-code', { stdio: 'pipe' });
  } catch {
    console.error('❌ Git working tree is dirty. Commit all changes first.');
    process.exit(1);
  }
  console.log('✅ Git working tree is clean');
  
  // Step 3: Update assets.js with mainnet key
  console.log('\nStep 3: Updating asset configuration...');
  const assetsFile = path.join(__dirname, '../src/config/assets.js');
  let content = fs.readFileSync(assetsFile, 'utf8');
  
  // Replace testnet key with mainnet key
  const testnetKey = TESTNET_KEYS[asset];
  const mainnetKey = MAINNET_KEYS[asset];
  
  if (!content.includes(testnetKey)) {
    console.error(`❌ Asset ${asset} not found in assets.js`);
    process.exit(1);
  }
  
  content = content.replace(
    new RegExp(`chain:\\s*['"]${testnetKey}['"]`),
    `chain: '${mainnetKey}'`
  );
  
  fs.writeFileSync(assetsFile, content);
  console.log(`✅ Updated ${asset} to mainnet (${mainnetKey})`);
  
  // Step 4: Create signed commit
  console.log('\nStep 4: Creating audit-signed commit...');
  execSync(`git add ${assetsFile}`, { stdio: 'pipe' });
  execSync(
    `git commit -m "Mainnet: Activate ${asset} (audit-approved 2026-07-05)"`,
    { stdio: 'pipe' }
  );
  console.log('✅ Commit created');
  
  // Step 5: Create release tag
  console.log('\nStep 5: Creating release tag...');
  const tag = `release-mainnet-${asset}-2026-07-05`;
  execSync(`git tag -a ${tag} -m "Mainnet activation for ${asset} (audited)"`, {
    stdio: 'pipe'
  });
  console.log(`✅ Tag created: ${tag}`);
  
  // Step 6: Push and create PR
  console.log('\nStep 6: Pushing to remote...');
  console.log(`\nTo proceed:\n`);
  console.log(`  git push origin mainnet-${asset}`);
  console.log(`  git push origin ${tag}`);
  console.log(`  gh pr create --base main --title "Mainnet: ${asset}" --body "Audit-approved mainnet deployment"`);
  console.log(`\n⚠️  Review PR thoroughly. Merge only after 2+ approvals from security team.\n`);
}

const asset = process.argv[2];
if (!asset) {
  console.error('Usage: node scripts/activate-mainnet.js ETH');
  process.exit(1);
}
activateMainnet(asset);
```

#### Step 3: Build Gate with Mainnet Flag
```javascript
// vite.config.js
export default {
  define: {
    __MAINNET_APPROVED__: process.env.MAINNET_APPROVED === '1'
  },
  build: {
    // ... other config
  }
}

// src/main.jsx
if (process.env.NODE_ENV === 'production' && !window.__MAINNET_APPROVED__) {
  console.error('❌ Mainnet keys detected but MAINNET_APPROVED flag not set!');
  console.error('This build cannot be deployed without audit approval.');
  throw new Error('Mainnet deployment requires audit approval');
}
```

**Build command**:
```bash
# Production build (requires MAINNET_APPROVED)
MAINNET_APPROVED=1 npm run build:release

# Without flag, build succeeds but app will not start if mainnet keys detected
npm run build  # ❌ Will fail if assets.js points to mainnet
```

#### Step 4: GitHub Protection Rules
```yaml
# .github/branch-protection.yml
Branch: main
  Require status checks to pass:
    - ✅ Validate Mainnet Keys (no mainnet keys in main branch)
    - ✅ ESLint (code quality)
    - ✅ Tests (functionality)
  
  Require branches to be up to date: YES
  Require code review: YES (2 required)
  Require CODEOWNERS review: YES
    # .github/CODEOWNERS
    # Mainnet-related changes require security team approval
    src/config/assets.js @security-team
    src/config/networks.js @security-team
  
  Restrict who can push to matching branches: @security-team only
```

---

### Implementation Timeline

**Day 1**: Implement validation gate + CI integration
**Day 2**: Implement multi-step activation script
**Day 3**: Wire GitHub branch protection
**Day 4**: Test entire flow (test activation → mainnet)
**Day 5**: Document process; train team

**Total Effort**: 5 days  
**Risk if Skipped**: CRITICAL (unguarded mainnet activation, fund loss risk)

---

