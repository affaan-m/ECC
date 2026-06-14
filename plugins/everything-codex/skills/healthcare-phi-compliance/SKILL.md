---
name: healthcare-phi-compliance
description: Protected Health Information (PHI) and Personally Identifiable Information (PII) compliance patterns for healthcare applications. Covers data classification, access control, audit trails, encryption, and common leak vectors.
---

# Healthcare PHI/PII Compliance Patterns

Patterns for protecting patient data, clinician data, and financial data in healthcare applications. Applicable to HIPAA (US), DISHA (India), GDPR (EU), and general healthcare data protection.

## When to Use

- Building any feature that touches patient records
- Implementing access control or authentication for clinical systems
- Designing database schemas for healthcare data
- Building APIs that return patient or clinician data
- Implementing audit trails or logging
- Reviewing code for data exposure vulnerabilities
- Setting up Row-Level Security (RLS) for multi-tenant healthcare systems

## How It Works

Healthcare data protection operates on three layers: **classification** (what is sensitive), **access control** (who can see it), and **audit** (who did see it).

### Data Classification

**PHI (Protected Health Information)** — any data that can identify a patient AND relates to their health: patient name, date of birth, address, phone, email, national ID numbers (SSN, Aadhaar, NHS number), medical record numbers, diagnoses, medications, lab results, imaging, insurance policy and claim details, appointment and admission records, or any combination of the above.

**PII (Non-patient-sensitive data)** in healthcare systems: clinician/staff personal details, doctor fee structures and payout amounts, employee salary and bank details, vendor payment information.

### Access Control: Row-Level Security

```sql
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

-- Scope access by facility
CREATE POLICY "staff_read_own_facility"
  ON patients FOR SELECT TO authenticated
  USING (facility_id IN (
    SELECT facility_id FROM staff_assignments
    WHERE user_id = auth.uid() AND role IN ('doctor','nurse','lab_tech','admin')
  ));

-- Audit log: insert-only (tamper-proof)
CREATE POLICY "audit_insert_only" ON audit_log FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "audit_no_modify" ON audit_log FOR UPDATE USING (false);
CREATE POLICY "audit_no_delete" ON audit_log FOR DELETE USING (false);
```

### Audit Trail

Every PHI access or modification must be logged:

```typescript
interface AuditEntry {
  timestamp: string;
  user_id: string;
  patient_id: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'print' | 'export';
  resource_type: string;
  resource_id: string;
  changes?: { before: object; after: object };
  ip_address: string;
  session_id: string;
}
```

### Common Leak Vectors

**Error messages:** Never include patient-identifying data in error messages thrown to the client. Log details server-side only.

**Console output:** Never log full patient objects. Use opaque internal record IDs (UUIDs) — not medical record numbers, national IDs, or names.

**URL parameters:** Never put patient-identifying data in query strings or path segments that could appear in logs or browser history. Use opaque UUIDs only.

**Browser storage:** Never store PHI in localStorage or sessionStorage. Keep PHI in memory only, fetch on demand.

**Service role keys:** Never use the service_role key in client-side code. Always use the anon/publishable key and let RLS enforce access.

**Logs and monitoring:** Never log full patient records. Use opaque record IDs only (not medical record numbers). Sanitize stack traces before sending to error tracking services.

### Database Schema Tagging

Mark PHI/PII columns at the schema level:

```sql
COMMENT ON COLUMN patients.name IS 'PHI: patient_name';
COMMENT ON COLUMN patients.dob IS 'PHI: date_of_birth';
COMMENT ON COLUMN patients.aadhaar IS 'PHI: national_id';
COMMENT ON COLUMN doctor_payouts.amount IS 'PII: financial';
```

### Deployment Checklist

Before every deployment:
- No PHI in error messages or stack traces
- No PHI in console.log/console.error
- No PHI in URL parameters
- No PHI in browser storage
- No service_role key in client code
- RLS enabled on all PHI/PII tables
- Audit trail for all data modifications
- Session timeout configured
- API authentication on all PHI endpoints
- Cross-facility data isolation verified

## Examples

### Example 1: Safe vs Unsafe Error Handling

```typescript
// BAD — leaks PHI in error
throw new Error(`Patient ${patient.name} not found in ${patient.facility}`);

// GOOD — generic error, details logged server-side with opaque IDs only
logger.error('Patient lookup failed', { recordId: patient.id, facilityId });
throw new Error('Record not found');
```

### Example 2: RLS Policy for Multi-Facility Isolation

```sql
-- Doctor at Facility A cannot see Facility B patients
CREATE POLICY "facility_isolation"
  ON patients FOR SELECT TO authenticated
  USING (facility_id IN (
    SELECT facility_id FROM staff_assignments WHERE user_id = auth.uid()
  ));

-- Test: login as doctor-facility-a, query facility-b patients
-- Expected: 0 rows returned
```

### Example 3: Safe Logging

```typescript
// BAD — logs identifiable patient data
console.log('Processing patient:', patient);

// GOOD — logs only opaque internal record ID
console.log('Processing record:', patient.id);
// Note: even patient.id should be an opaque UUID, not a medical record number
```
