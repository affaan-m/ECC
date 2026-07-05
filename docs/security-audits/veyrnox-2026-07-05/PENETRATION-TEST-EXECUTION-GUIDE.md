# VEYRNOX Penetration Test Execution Guide
**Date**: 2026-07-05  
**Focus**: Coercion Resistance Testing  
**Environment**: VITE_DEMO_MODE=1 npm run dev (Staging)  
**Test Duration**: 4-6 hours (6 scenarios, 74 tests)

---

## Part 1: Test Environment Setup

### Prerequisites
```bash
# Terminal 1: Start dev server
cd /path/to/veyrnox
VITE_DEMO_MODE=1 npm run dev
# Server runs at http://localhost:5173 (or configured port)

# Terminal 2: Open in browser
# Navigate to http://localhost:5173
# Enable DevTools (F12) for network/storage inspection
```

### Test Tools Needed
- **Browser**: Chrome/Firefox (DevTools required)
- **Network Inspector**: DevTools Network tab (verify zero backend calls)
- **Storage Inspector**: DevTools Application > Local Storage, IndexedDB, sessionStorage
- **Console**: DevTools Console (check for errors during test scenarios)
- **Note-taking**: Spreadsheet to record test results

### Test Credentials Setup (From Demo Mode)
The wallet should auto-generate test wallets in demo mode:
- **Real Wallet PIN**: [Document actual PIN from app]
- **Decoy Wallet PIN**: [Document actual PIN from app]
- **Hidden Wallet PIN**: [Document actual PIN from app]
- **Panic Wipe PIN**: [Document actual PIN from app]

**Setup Test Case**:
```
1. Launch app (VITE_DEMO_MODE=1)
2. Create/import wallets (app may auto-populate in demo mode)
3. Note all PIN values
4. Document initial balance states
5. Proceed to Scenario 1
```

---

## Part 2: Scenario-by-Scenario Test Execution

### 🔴 SCENARIO 1: Duress PIN Entry Under Coercion

**Duration**: 30 minutes  
**Threat Model**: T4 (Physical coercion)  
**Expected Outcome**: Decoy wallet indistinguishable from real; zero backend calls

#### Setup
```
Pre-conditions:
1. Real wallet unlocked with REAL PIN
2. Real wallet shows balances (e.g., 1.0 ETH, 50 USDC)
3. Close/lock wallet
4. Clear browser DevTools (F12 > Console > Clear)
5. Clear Network tab history
```

#### Test Execution

| # | Test Step | Expected Result | Actual Result | Pass/Fail | Notes |
|---|-----------|-----------------|---------------|-----------|-------|
| 1.1 | Launch app (if not already running) | App loads, lock screen visible | | | |
| 1.2 | Tap "Unlock" button | PIN entry screen appears | | | |
| 1.3 | Enter **DECOY PIN** (not real PIN) | PIN input accepted | | | **CRITICAL**: Must be different from real PIN |
| 1.4 | Press "Unlock" button | Decoy wallet loads (or real wallet with empty balance?) | | | VERIFY: Which wallet loaded? |
| 1.5 | Check displayed balance (ETH) | Should be 0 or dummy value (NOT same as real wallet) | | | VERIFY: Balance matches decoy setup |
| 1.6 | Check displayed balance (USDC) | Should be 0 or dummy value | | | VERIFY: Consistent with decoy |
| 1.7 | Open DevTools (F12) Network tab | Clear any existing logs, click "Start recording" | | | |
| 1.8 | Navigate to Settings or Portfolio view (while in decoy) | Network calls appear? | | | CRITICAL: Should see ZERO backend calls |
| 1.9 | Check network requests | ALL requests should be local or to whitelisted endpoints (NOT backend API) | | | **CRITICAL SECURITY CHECK**: No duress phone-home |
| 1.10 | Open DevTools Application tab > Local Storage | Check vault storage | | | VERIFY: Storage size consistent with expected |
| 1.11 | Search local storage for mode identifiers (search for "decoy", "real", "duress") | SHOULD NOT find wallet mode indicators | | | **CRITICAL**: No metadata leakage |
| 1.12 | Lock wallet (Settings > Lock) | Lock screen appears | | | |
| 1.13 | Enter **REAL PIN** | Real wallet unlocks | | | VERIFY: Real wallet loads, not decoy |
| 1.14 | Check balance (should match pre-test) | ETH: 1.0, USDC: 50 (as before) | | | VERIFY: Real wallet unchanged by decoy access |

#### Pass/Fail Criteria
- ✅ **PASS** if:
  - Decoy PIN loads decoy wallet (not rejected)
  - Decoy balances are DIFFERENT from real wallet
  - Network tab shows ZERO backend calls during decoy access
  - Local storage shows NO mode indicators (real/decoy/duress)
  - Real wallet re-appears with correct PIN, balances intact
  - Error messages are generic (no "decoy mode detected")

- ❌ **FAIL** if:
  - Decoy PIN is rejected or shows error
  - Decoy wallet balances match real wallet (same amounts)
  - Backend call made during decoy access (especially to auth/balance endpoints)
  - Local storage reveals wallet mode
  - Real wallet corrupted or balance changed

#### Findings Template
```
Finding: [Test 1.X] [PASS/FAIL]
Description: [What was tested]
Expected: [Expected behavior]
Actual: [Actual observed behavior]
Severity: [CRITICAL/HIGH/MEDIUM/LOW]
Remediation: [If failed, what needs fixing]
```

---

### 🔴 SCENARIO 2: Decoy Wallet Fund Transfer Attempt

**Duration**: 25 minutes  
**Threat Model**: T4 (Coercion + fund extraction attempt)  
**Expected Outcome**: Transfer fails gracefully; error message doesn't reveal decoy mode

#### Setup
```
Pre-conditions (from Scenario 1 end state):
1. Real wallet locked
2. Decoy PIN available
3. Network DevTools tab active and recording
```

#### Test Execution

| # | Test Step | Expected Result | Actual Result | Pass/Fail | Notes |
|---|-----------|-----------------|---------------|-----------|-------|
| 2.1 | Unlock wallet with DECOY PIN | Decoy wallet loads | | | |
| 2.2 | Check displayed balances | ETH ≈ 0, USDC ≈ 0 (or small dummy values) | | | |
| 2.3 | Tap "Send" or "Transfer" button | Send dialog opens | | | |
| 2.4 | Enter recipient address (copy from real wallet or use test address) | Address entered | | | Use known address (e.g., your real wallet) |
| 2.5 | Enter amount to send (e.g., 0.5 ETH) | Amount entered | | | |
| 2.6 | Tap "Review" or "Next" button | Review screen shows (or error appears) | | | |
| 2.7 | Check error message (if transfer fails pre-submission) | Error message is generic: "Insufficient balance" or "Not enough funds" | | | **CRITICAL**: Error MUST NOT say "decoy" or "wallet not available" |
| 2.8 | If no error, tap "Confirm" to submit transfer | Transfer is rejected OR shows "Insufficient balance" | | | Should fail; decoy has no funds |
| 2.9 | Check Network tab for API calls | Zero requests to backend (or request made but rejected by decoy validation) | | | **CRITICAL**: No duress backend call |
| 2.10 | Check error message displayed to user | Generic message like "Transaction failed" or "Insufficient balance" | | | Should NOT reveal decoy wallet state |
| 2.11 | Lock wallet (Settings > Lock) | Lock screen | | | |
| 2.12 | Unlock with REAL PIN | Real wallet loads | | | |
| 2.13 | Check balance (real wallet) | ETH: 1.0, USDC: 50 (unchanged) | | | Verify real wallet untouched |
| 2.14 | Attempt same transfer from REAL wallet | Transfer should succeed (real funds available) | | | |
| 2.15 | Check blockchain explorer (if testnet) | Real transfer visible; NO decoy transfer visible | | | Verify: Decoy transaction never touched chain |

#### Pass/Fail Criteria
- ✅ **PASS** if:
  - Decoy transfer attempt fails with generic error
  - Error message is indistinguishable from real empty wallet failure
  - Network shows zero backend API calls OR request made but silently rejected
  - Real wallet transfer succeeds (proves real wallet has funds)
  - Blockchain shows ONLY real transfer, not decoy attempt

- ❌ **FAIL** if:
  - Error message says "decoy wallet" or "duress mode"
  - Backend API call made to transfer endpoint during duress
  - Decoy transfer actually succeeds or appears on chain
  - Real wallet balance affected by decoy attempt

---

### 🔴 SCENARIO 3: Panic Wipe Under Duress

**Duration**: 30 minutes  
**Threat Model**: T4 (Coercion escalation; user triggers panic wipe to destroy keys)  
**Expected Outcome**: All keys destroyed irreversibly; recovery impossible

#### Setup
```
Pre-conditions:
1. Real wallet unlocked and visible
2. Panic wipe PIN documented
3. Browser DevTools Storage tab active
```

#### Test Execution

| # | Test Step | Expected Result | Actual Result | Pass/Fail | Notes |
|---|-----------|-----------------|---------------|-----------|-------|
| 3.1 | From real wallet, navigate to Settings > Security | Settings screen visible | | | |
| 3.2 | Locate "Panic Wipe" or "Emergency Wipe" option | Panic wipe option visible (may be in Settings > Advanced or Security tab) | | | |
| 3.3 | Tap "Panic Wipe" | Confirmation dialog appears asking for panic PIN | | | Should require explicit PIN |
| 3.4 | Enter PANIC PIN | PIN accepted | | | **CRITICAL**: Panic PIN should be different from real/decoy |
| 3.5 | Review confirmation message (if any) | Message shows "This action is irreversible" or similar | | | Should be clear about irreversibility |
| 3.6 | Tap "Confirm" to proceed with wipe | Wipe initiated; app may show progress or "Wiping..." message | | | |
| 3.7 | Wait for wipe to complete (document time taken) | Wipe completes; app may auto-lock or show "Wiped" message | | | Document: Wipe time = _____ seconds |
| 3.8 | Check DevTools Storage > Local Storage | Vault blob is GONE or encrypted with no accessible key material | | | **CRITICAL**: No key material visible |
| 3.9 | Check DevTools Storage > IndexedDB | Any wallet data should be DELETED | | | Verify complete erasure |
| 3.10 | Attempt to unlock with REAL PIN | Unlock FAILS (keys destroyed) | | | **CRITICAL**: Real PIN no longer works |
| 3.11 | Attempt to unlock with DECOY PIN | Unlock FAILS (keys destroyed) | | | Verify both PINs fail |
| 3.12 | Attempt recovery from backup (if recovery feature exists) | Recovery FAILS or shows "No backup available" | | | Verify no recovery path |
| 3.13 | Force-restart app (close browser tab, reopen localhost:5173) | App relaunches in locked state | | | |
| 3.14 | Attempt to unlock with REAL PIN | Unlock FAILS (keys still destroyed after restart) | | | Verify wipe is persistent |
| 3.15 | [OPTIONAL - If device supports forensic dump] Dump local storage to disk | Analyze dump for ANY key material | | | Check for leftover keys |

#### Interrupt Safety Test (Optional But Important)
```
3.16 | During wipe (Step 3.6), kill app mid-process
      | Method: Close browser tab or force-close app
      | Expected: Wipe completes or fails safely (keys safe either way)

3.17 | After interrupt, restart app and attempt unlock
      | Expected: Unlock fails (keys destroyed despite interrupt)
      | CRITICAL: Verify fail-closed behavior (keys safe, not partially wiped)
```

#### Pass/Fail Criteria
- ✅ **PASS** if:
  - Panic wipe requires explicit PIN confirmation
  - All keys destroyed (real, decoy, hidden)
  - Recovery is impossible (all PINs fail)
  - Wipe persists after app restart
  - No key material visible in storage
  - Interruption (if tested) results in safe state (keys destroyed or safe)

- ❌ **FAIL** if:
  - Panic wipe triggers without confirmation
  - Partial wipe (some keys remain)
  - Real PIN still works after wipe
  - Recovery pathway still accessible
  - Key material visible in storage dump
  - Interrupted wipe leaves keys partially accessible

---

### 🟡 SCENARIO 4: Stealth Wallet Hidden Reveal

**Duration**: 25 minutes  
**Threat Model**: T4 (Coercion; attacker cannot detect hidden wallet existence)  
**Expected Outcome**: No metadata footprint; hidden wallet undetectable without PIN

#### Setup
```
Pre-conditions:
1. Device storage is clean (previous panic wipe completed, or new app instance)
2. Or: Hidden wallet was previously created but locked
3. DevTools Storage tab active
```

#### Test Execution

| # | Test Step | Expected Result | Actual Result | Pass/Fail | Notes |
|---|-----------|-----------------|---------------|-----------|-------|
| 4.1 | Inspect DevTools > Local Storage (before unlocking hidden) | NO entry mentioning "hidden" or "stealth" | | | **CRITICAL**: Hidden wallet should be undetectable |
| 4.2 | Search for "walletMeta" or similar metadata entry | SHOULD NOT find hidden wallet entry | | | Verify: Hidden wallet leaves no metadata |
| 4.3 | Unlock app with HIDDEN PIN | Hidden wallet revealed/unlocked | | | |
| 4.4 | Check displayed wallet name (if any) | Should be generic (e.g., "Wallet" or "Account") or user-defined (not "Hidden") | | | No mode indicator in UI |
| 4.5 | Navigate to each chain (ETH, BTC, SOL, etc.) | All addresses visible and derived (not lazily loaded) | | | **CRITICAL**: Multi-chain atomicity (all derived together) |
| 4.6 | Check address format (ETH) | Valid Ethereum address (0x...) | | | Standard format, no indicators |
| 4.7 | Check address format (BTC) | Valid Bitcoin address (1, 3, or bc1 prefix) | | | Standard format |
| 4.8 | Check address format (SOL) | Valid Solana address | | | Standard format |
| 4.9 | Verify addresses are NOT the same as real/decoy wallet addresses | Each address should be UNIQUE (not derived from same seed) | | | **CRITICAL**: Address isolation |
| 4.10 | Lock wallet | Lock screen appears | | | |
| 4.11 | Inspect DevTools > Local Storage again | STILL no mention of "hidden" or "stealth" in metadata | | | **CRITICAL**: Hidden wallet undetectable when locked |
| 4.12 | [OPTIONAL] Search blockchain for any hidden addresses | No addresses appear in blockchain under name/metadata | | | Verify: No chain linkage to hidden wallet |

#### Forensic Detection Test (Optional But Important)
```
4.13 | Attempt to brute-force unlock with random PINs
      | Expected: Real and decoy PINs work; hidden PIN harder to guess
      | Result: Document how many attempts before each unlock type reveals

4.14 | Analyze address generation pattern
      | Expected: Cannot correlate hidden addresses to real/decoy wallets
      | Check: Are addresses in same HD path? Should be DIFFERENT
```

#### Pass/Fail Criteria
- ✅ **PASS** if:
  - Hidden wallet leaves no on-device metadata footprint
  - No `walletMeta` entry or similar reveals existence
  - All multi-chain addresses are derived (not lazy-loaded)
  - Addresses are cryptographically isolated from real/decoy
  - Hidden wallet undetectable without correct PIN
  - Storage dump shows no hidden wallet indicators

- ❌ **FAIL** if:
  - `walletMeta` entry reveals hidden wallet
  - "Hidden" or "Stealth" appears in wallet name/metadata
  - Addresses are lazy-loaded (some chains missing until accessed)
  - Hidden addresses are derivable from real/decoy seed
  - Hidden wallet detectable from storage dump alone

---

### 🟡 SCENARIO 5: Audit Log Deniability

**Duration**: 20 minutes  
**Threat Model**: T2 (Backend breach) + T4 (Coercion + log inspection)  
**Expected Outcome**: Audit log is opt-in, encrypted, non-fingerprinting

#### Setup
```
Pre-conditions:
1. Wallet is locked
2. Audit log feature is accessible from settings
3. No prior log data (or log is cleared)
```

#### Test Execution

| # | Test Step | Expected Result | Actual Result | Pass/Fail | Notes |
|---|-----------|-----------------|---------------|-----------|-------|
| 5.1 | Unlock wallet with REAL PIN | Real wallet loads | | | |
| 5.2 | Navigate to Settings > Privacy or Settings > Audit Log | Audit log settings visible | | | |
| 5.3 | Check audit log toggle/status | Audit log is **OFF by default** | | | **CRITICAL**: Opt-in only |
| 5.4 | Check for "Enable Audit Log" option | Button/toggle to enable exists | | | |
| 5.5 | Enable audit log (click toggle to ON) | Confirmation or explanation shown | | | May ask for password confirmation |
| 5.6 | Make a transaction (e.g., send 0.1 ETH to test address) | Transaction submitted and confirmed | | | |
| 5.7 | Wait for transaction to complete (may take seconds to minutes) | Transaction appears in history | | | |
| 5.8 | Go to Settings > Audit Log > View Log (or similar) | Log entries visible | | | |
| 5.9 | Check log entry content | Entry shows: Transaction ID, Amount, Recipient (encrypted or hashed), Timestamp, Status | | | |
| 5.10 | Verify entry does NOT include: | Entry should NOT show: wallet mode (real/decoy/hidden), IP address, device ID, unlock method | | | **CRITICAL**: No fingerprinting |
| 5.11 | Check log encryption | Raw log file (if inspectable) is encrypted/unreadable | | | Open DevTools > Application > Verify log blob is encrypted |
| 5.12 | Unlock with DECOY PIN (in separate test) | Decoy wallet loads | | | |
| 5.13 | Check: Does decoy make transactions appear in real wallet's log? | Decoy transactions should EITHER not appear, OR appear as generic entries (not marked "decoy") | | | **CRITICAL**: No fingerprinting |
| 5.14 | Disable audit log (toggle OFF) | Log disabled | | | |
| 5.15 | Make another transaction (while log is OFF) | Transaction completes | | | |
| 5.16 | Check: Is new transaction in log? | New transaction should NOT be logged (log is off) | | | Verify off-by-default behavior |
| 5.17 | [OPTIONAL] Enable log again and attempt decryption without correct PIN | Decryption fails (log unreadable) | | | Test encryption strength |

#### Pass/Fail Criteria
- ✅ **PASS** if:
  - Audit log is OFF by default (not logging silently)
  - Entries are encrypted (raw storage is unreadable)
  - Entries are non-fingerprinting (no mode/IP/device ID)
  - Log can be disabled/enabled independently
  - Decoy transactions don't fingerprint mode
  - Wrong PIN cannot decrypt log

- ❌ **FAIL** if:
  - Audit log is ON by default
  - Log entries are readable plaintext
  - Entries show wallet mode ("real", "decoy", "hidden")
  - Log includes IP address or device identifiers
  - Decoy transactions marked differently than real
  - Log can be decrypted without correct PIN

---

### 🟢 SCENARIO 6: Escape Paths & Session Management

**Duration**: 15 minutes  
**Threat Model**: T4 (Coercion escalation; user needs escape paths)  
**Expected Outcome**: Panic wipe/wallet switch accessible from any state; timeout enforced

#### Setup
```
Pre-conditions:
1. Wallet is unlocked (any mode: real, decoy, or hidden)
2. User is on a transaction screen or portfolio screen
```

#### Test Execution

| # | Test Step | Expected Result | Actual Result | Pass/Fail | Notes |
|---|-----------|-----------------|---------------|-----------|-------|
| 6.1 | From real wallet, open navigation menu (Settings or Menu icon) | Menu shows options: Send, Receive, Settings, Security, etc. | | | |
| 6.2 | Navigate to Settings > Security | Security settings visible | | | |
| 6.3 | Locate "Panic Wipe" option | Panic wipe accessible from Settings | | | Should not be hidden or buried |
| 6.4 | [ALT PATH] From dashboard, try keyboard shortcut (if any) for panic | Panic option appears via shortcut | | | Document any shortcuts |
| 6.5 | [ALT PATH] Try three-finger tap or emergency gesture (if designed) | Emergency gesture triggers panic wipe setup | | | Document any alternative triggers |
| 6.6 | Trigger panic wipe (confirm PIN) | Wipe completes (verify in Scenario 3) | | | Confirm accessibility from any screen |
| 6.7 | Test session timeout: Unlock wallet and leave idle for 5+ minutes | Wallet auto-locks (if timeout enabled) | | | Document timeout duration: _____ seconds |
| 6.8 | Attempt to access wallet data without re-unlocking | Access denied; requires PIN re-entry | | | Verify timeout enforcement |
| 6.9 | Force-close app (close browser tab) | App closes | | | |
| 6.10 | Reopen app | Lock screen appears; requires PIN to unlock | | | Verify: Session does not persist |

#### Rate Limiting Test
```
6.11 | Attempt multiple wrong PIN entries (e.g., 5 wrong attempts)
      | Expected: Rate limiting engaged (device locked, cooldown, etc.)
      | Result: Document: Lockout after _____ attempts, cooldown _____ seconds

6.12 | Wait for cooldown; attempt correct PIN
      | Expected: Unlock succeeds after cooldown
      | Result: Verify rate limiting is not permanent
```

#### Pass/Fail Criteria
- ✅ **PASS** if:
  - Panic wipe accessible from any screen
  - Session timeout enforces auto-lock
  - App-kill doesn't preserve session
  - Rate limiting prevents brute force
  - All escape paths require authentication (PIN/biometric)

- ❌ **FAIL** if:
  - Panic wipe hidden or inaccessible
  - No session timeout (app stays unlocked)
  - App-kill preserves unlocked session
  - No rate limiting on wrong PINs
  - Escape paths don't require re-authentication

---

## Part 3: Test Results Compilation

### Results Template

```markdown
# VEYRNOX Penetration Test Results

**Test Date**: [Date]
**Tester**: [Name/ID]
**Environment**: VITE_DEMO_MODE=1, Browser: [Chrome/Firefox], Version: [V#]
**Total Tests**: 74
**Tests Passed**: [#]
**Tests Failed**: [#]
**Critical Issues**: [#]

## Scenario Results

### Scenario 1: Duress PIN Entry
- Status: [PASS/FAIL]
- Tests Passed: [#/14]
- Critical Issues: [List any]
- Findings:
  - [Finding 1]
  - [Finding 2]

### Scenario 2: Decoy Fund Transfer
- Status: [PASS/FAIL]
- Tests Passed: [#/15]
- Critical Issues: [List any]

[Continue for all 6 scenarios]

## Critical Findings

### CRITICAL [#1]: [Issue Title]
- **Severity**: CRITICAL
- **Test**: [Scenario X, Test X.X]
- **Description**: [What failed]
- **Impact**: [Why it matters]
- **Remediation**: [How to fix]

## Security Verdict

**Overall**: [PASS / CONDITIONAL PASS / FAIL]
**Duress Resistance**: [VERIFIED / UNVERIFIED / FAILED]
**Coercion Mitigation**: [Strong / Adequate / Weak]
**Mainnet Readiness**: [Ready / Conditional / Not Ready]

## Recommendations

1. [Priority 1 recommendation]
2. [Priority 2 recommendation]
3. [Priority 3 recommendation]
```

---

## Part 4: Test Execution Checklist

- [ ] Environment set up (app running, DevTools open)
- [ ] Test credentials documented
- [ ] Scenario 1 (Duress PIN): All 14 tests completed
- [ ] Scenario 2 (Decoy Transfer): All 15 tests completed
- [ ] Scenario 3 (Panic Wipe): All 15 tests completed
- [ ] Scenario 4 (Stealth Reveal): All 12 tests completed
- [ ] Scenario 5 (Audit Log): All 17 tests completed
- [ ] Scenario 6 (Escape Paths): All 10 tests completed
- [ ] Critical findings documented
- [ ] Results compiled in template
- [ ] Verdict reached (PASS/FAIL)
- [ ] Recommendations generated

---

## Part 5: Pass/Fail Grading Rubric

### Overall Test Verdict

**🟢 PASS** (Zero critical failures, all deniability properties verified):
- All 6 scenarios PASS
- No backend calls during duress
- No metadata leakage
- Panic wipe irreversible
- Audit log non-fingerprinting

**🟡 CONDITIONAL PASS** (1-2 high-severity issues, correctable):
- 5/6 scenarios PASS (one scenario has minor issues)
- Isolated backend call during duress (can be remedied)
- Audit log encryption weak but present
- Rate limiting insufficient (can be tightened)

**🔴 FAIL** (3+ critical failures, deniability compromised):
- 3+ scenarios FAIL
- Decoy wallet distinguishable from real
- Backend calls made during duress (fundamental egress cut failure)
- Panic wipe reversible
- Metadata reveals wallet mode to attacker

---

