---
name: healthcare-phi-compliance
description: 医疗应用中受保护健康信息（PHI）和个人身份信息（PII）的合规模式。涵盖数据分类、访问控制、审计追踪、加密及常见泄露途径。
origin: Health1 Super Speciality Hospitals — contributed by Dr. Keyur Patel
version: "1.0.0"
---

# 医疗 PHI/PII 合规模式

用于保护医疗应用中患者数据、临床医生数据和财务数据的模式。适用于 HIPAA（美国）、DISHA（印度）、GDPR（欧盟）以及通用医疗数据保护。

## 何时使用

* 构建任何涉及患者记录的功能
* 为临床系统实施访问控制或身份验证
* 设计医疗数据的数据库模式
* 构建返回患者或临床医生数据的 API
* 实施审计追踪或日志记录
* 审查代码中的数据泄露漏洞
* 为多租户医疗系统设置行级安全（RLS）

## 工作原理

医疗数据保护在三个层面运作：**分类**（什么是敏感数据）、**访问控制**（谁能查看）和**审计**（谁查看了数据）。

### 数据分类

**PHI（受保护健康信息）** — 任何能够识别患者身份且与其健康相关的数据：患者姓名、出生日期、地址、电话、电子邮件、国家身份证号码（SSN、Aadhaar、NHS 号码）、病历号、诊断、药物、化验结果、影像资料、保险单和理赔详情、预约和入院记录，或上述任意组合。

**医疗系统中的 PII（非患者敏感数据）**：临床医生/员工个人详细信息、医生收费结构和支付金额、员工薪资和银行信息、供应商付款信息。

### 访问控制：行级安全

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

### 审计追踪

每次 PHI 访问或修改都必须记录：

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

### 常见泄露途径

**错误消息：** 切勿在发送给客户端的错误消息中包含患者身份识别数据。仅在服务器端记录详细信息。

**控制台输出：** 切勿记录完整的患者对象。使用不透明的内部记录 ID（UUID）——而不是病历号、国家身份证号或姓名。

**URL 参数：** 切勿在可能出现在日志或浏览器历史记录中的查询字符串或路径段中包含患者身份识别数据。仅使用不透明的 UUID。

**浏览器存储：** 切勿在 localStorage 或 sessionStorage 中存储 PHI。仅在内存中保留 PHI，按需获取。

**服务角色密钥：** 切勿在客户端代码中使用 service\_role 密钥。始终使用匿名/可发布密钥，并让 RLS 强制执行访问控制。

**日志和监控：** 切勿记录完整的患者记录。仅使用不透明的记录 ID（而不是病历号）。在发送到错误跟踪服务之前，清理堆栈跟踪。

### 数据库模式标记

在模式级别标记 PHI/PII 列：

```sql
COMMENT ON COLUMN patients.name IS 'PHI: patient_name';
COMMENT ON COLUMN patients.dob IS 'PHI: date_of_birth';
COMMENT ON COLUMN patients.aadhaar IS 'PHI: national_id';
COMMENT ON COLUMN doctor_payouts.amount IS 'PII: financial';
```

### 部署检查清单

每次部署前：

* 错误消息或堆栈跟踪中无 PHI
* console.log/console.error 中无 PHI
* URL 参数中无 PHI
* 浏览器存储中无 PHI
* 客户端代码中无 service\_role 密钥
* 所有 PHI/PII 表已启用 RLS
* 所有数据修改均有审计追踪
* 已配置会话超时
* 所有 PHI 端点均需 API 身份验证
* 已验证跨机构数据隔离

## 示例

### 示例 1：安全与不安全的错误处理

```typescript
// BAD — leaks PHI in error
throw new Error(`Patient ${patient.name} not found in ${patient.facility}`);

// GOOD — generic error, details logged server-side with opaque IDs only
logger.error('Patient lookup failed', { recordId: patient.id, facilityId });
throw new Error('Record not found');
```

### 示例 2：多机构隔离的 RLS 策略

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

### 示例 3：安全日志记录

```typescript
// BAD — logs identifiable patient data
console.log('Processing patient:', patient);

// GOOD — logs only opaque internal record ID
console.log('Processing record:', patient.id);
// Note: even patient.id should be an opaque UUID, not a medical record number
```
