| name | description |
|------|-------------|
| cloud-infrastructure-security | Use this skill when deploying to cloud platforms, configuring infrastructure, managing IAM policies, setting up logging/monitoring, or implementing CI/CD pipelines. Provides cloud security checklist aligned with best practices. |

# 雲端與基礎設施安全技能

此技能確保雲端基礎設施、CI/CD 管線和部署設定遵循安全最佳實務並符合業界標準。

## 何時啟用

- 部署應用程式到雲端平台（AWS、Vercel、Railway、Cloudflare）
- 設定 IAM 角色和權限
- 設置 CI/CD 管線
- 實作基礎設施即程式碼（Terraform、CloudFormation）
- 設定日誌和監控
- 在雲端環境管理密鑰
- 設置 CDN 和邊緣安全
- 實作災難復原和備份策略

## 雲端安全檢查清單

### 1. IAM 與存取控制

#### 最小權限原則

```yaml
# PASS: 正確：最小權限
iam_role:
  permissions:
    - s3:GetObject  # 只有讀取存取
    - s3:ListBucket
  resources:
    - arn:aws:s3:::my-bucket/*  # 只有特定 bucket

# FAIL: 錯誤：過於廣泛的權限
iam_role:
  permissions:
    - s3:*  # 所有 S3 動作
  resources:
    - "*"  # 所有資源
```

#### 多因素認證（MFA）

```bash
# 總是為 root/admin 帳戶啟用 MFA
aws iam enable-mfa-device \
  --user-name admin \
  --serial-number arn:aws:iam::123456789:mfa/admin \
  --authentication-code1 123456 \
  --authentication-code2 789012
```

#### 驗證步驟

- [ ] 生產環境不使用 root 帳戶
- [ ] 所有特權帳戶啟用 MFA
- [ ] 服務帳戶使用角色，非長期憑證
- [ ] IAM 政策遵循最小權限
- [ ] 定期進行存取審查
- [ ] 未使用憑證已輪換或移除

### 2. 密鑰管理

#### 雲端密鑰管理器

```typescript
// PASS: 正確：使用雲端密鑰管理器
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManager({ region: 'us-east-1' });
const secret = await client.getSecretValue({ SecretId: 'prod/api-key' });
const apiKey = JSON.parse(secret.SecretString).key;

// FAIL: 錯誤：寫死或只在環境變數
const apiKey = process.env.API_KEY; // 未輪換、未稽核
```

#### 密鑰輪換

```bash
# 為資料庫憑證設定自動輪換
aws secretsmanager rotate-secret \
  --secret-id prod/db-password \
  --rotation-lambda-arn arn:aws:lambda:region:account:function:rotate \
  --rotation-rules AutomaticallyAfterDays=30
```

#### 驗證步驟

- [ ] 所有密鑰儲存在雲端密鑰管理器（AWS Secrets Manager、Vercel Secrets）
- [ ] 資料庫憑證啟用自動輪換
- [ ] API 金鑰至少每季輪換
- [ ] 程式碼、日誌或錯誤訊息中無密鑰
- [ ] 密鑰存取啟用稽核日誌

### 3. 網路安全

#### VPC 和防火牆設定

```terraform
# PASS: 正確：限制的安全群組
resource "aws_security_group" "app" {
  name = "app-sg"

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]  # 只有內部 VPC
  }

  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]  # 只有 HTTPS 輸出
  }
}

# FAIL: 錯誤：對網際網路開放
resource "aws_security_group" "bad" {
  ingress {
    from_port   = 0
    to_port     = 65535
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]  # 所有埠、所有 IP！
  }
}
```

#### 驗證步驟

- [ ] 資料庫不可公開存取
- [ ] SSH/RDP 埠限制為 VPN/堡壘機
- [ ] 安全群組遵循最小權限
- [ ] 網路 ACL 已設定
- [ ] VPC 流量日誌已啟用

### 4. 日誌與監控

#### CloudWatch/日誌設定

```typescript
// PASS: 正確：全面日誌記錄
import { CloudWatchLogsClient, CreateLogStreamCommand } from '@aws-sdk/client-cloudwatch-logs';

const logSecurityEvent = async (event: SecurityEvent) => {
  await cloudwatch.putLogEvents({
    logGroupName: '/aws/security/events',
    logStreamName: 'authentication',
    logEvents: [{
      timestamp: Date.now(),
      message: JSON.stringify({
        type: event.type,
        userId: event.userId,
        ip: event.ip,
        result: event.result,
        // 永遠不要記錄敏感資料
      })
    }]
  });
};
```

#### 驗證步驟

- [ ] 所有服務啟用 CloudWatch/日誌記錄
- [ ] 失敗的認證嘗試被記錄
- [ ] 管理員動作被稽核
- [ ] 日誌保留已設定（合規需 90+ 天）
- [ ] 可疑活動設定警報
- [ ] 日誌集中化且防篡改

### 5. CI/CD 管線安全

#### 安全管線設定

```yaml
# PASS: 正確：安全的 GitHub Actions 工作流程
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read  # 最小權限

    steps:
      - uses: actions/checkout@v4

      # 掃描密鑰
      - name: Secret scanning
        uses: trufflesecurity/trufflehog@main

      # 依賴稽核
      - name: Audit dependencies
        run: npm audit --audit-level=high

      # 使用 OIDC，非長期 tokens
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789:role/GitHubActionsRole
          aws-region: us-east-1
```

#### 供應鏈安全

```json
// package.json - 使用 lock 檔案和完整性檢查
{
  "scripts": {
    "install": "npm ci",  // 使用 ci 以獲得可重現建置
    "audit": "npm audit --audit-level=moderate",
    "check": "npm outdated"
  }
}
```

#### 驗證步驟

- [ ] 使用 OIDC 而非長期憑證
- [ ] 管線中的密鑰掃描
- [ ] 依賴漏洞掃描
- [ ] 容器映像掃描（如適用）
- [ ] 強制執行分支保護規則
- [ ] 合併前需要程式碼審查
- [ ] 強制執行簽署 commits

### 6. Cloudflare 與 CDN 安全

#### Cloudflare 安全設定

```typescript
// PASS: 正確：帶安全標頭的 Cloudflare Workers
export default {
  async fetch(request: Request): Promise<Response> {
    const response = await fetch(request);

    // 新增安全標頭
    const headers = new Headers(response.headers);
    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Permissions-Policy', 'geolocation=(), microphone=()');

    return new Response(response.body, {
      status: response.status,
      headers
    });
  }
};
```

#### WAF 規則

```bash
# 啟用 Cloudflare WAF 管理規則
# - OWASP 核心規則集
# - Cloudflare 管理規則集
# - 速率限制規則
# - Bot 保護
```

#### 驗證步驟

- [ ] WAF 啟用 OWASP 規則
- [ ] 速率限制已設定
- [ ] Bot 保護啟用
- [ ] DDoS 保護啟用
- [ ] 安全標頭已設定
- [ ] SSL/TLS 嚴格模式啟用

### 7. 備份與災難復原

#### 自動備份

```terraform
# PASS: 正確：自動 RDS 備份
resource "aws_db_instance" "main" {
  allocated_storage     = 20
  engine               = "postgres"

  backup_retention_period = 30  # 30 天保留
  backup_window          = "03:00-04:00"
  maintenance_window     = "mon:04:00-mon:05:00"

  enabled_cloudwatch_logs_exports = ["postgresql"]

  deletion_protection = true  # 防止意外刪除
}
```

#### 驗證步驟

- [ ] 已設定自動每日備份
- [ ] 備份保留符合合規要求
- [ ] 已啟用時間點復原
- [ ] 每季執行備份測試
- [ ] 災難復原計畫已記錄
- [ ] RPO 和 RTO 已定義並測試

## 部署前雲端安全檢查清單

任何生產雲端部署前：

- [ ] **IAM**：不使用 root 帳戶、啟用 MFA、最小權限政策
- [ ] **密鑰**：所有密鑰在雲端密鑰管理器並有輪換
- [ ] **網路**：安全群組受限、無公開資料庫
- [ ] **日誌**：CloudWatch/日誌啟用並有保留
- [ ] **監控**：異常設定警報
- [ ] **CI/CD**：OIDC 認證、密鑰掃描、依賴稽核
- [ ] **CDN/WAF**：Cloudflare WAF 啟用 OWASP 規則
- [ ] **加密**：資料靜態和傳輸中加密
- [ ] **備份**：自動備份並測試復原
- [ ] **合規**：符合 GDPR/HIPAA 要求（如適用）
- [ ] **文件**：基礎設施已記錄、建立操作手冊
- [ ] **事件回應**：安全事件計畫就位

## 常見雲端安全錯誤設定

### S3 Bucket 暴露

```bash
# FAIL: 錯誤：公開 bucket
aws s3api put-bucket-acl --bucket my-bucket --acl public-read

# PASS: 正確：私有 bucket 並有特定存取
aws s3api put-bucket-acl --bucket my-bucket --acl private
aws s3api put-bucket-policy --bucket my-bucket --policy file://policy.json
```

### RDS 公開存取

```terraform
# FAIL: 錯誤
resource "aws_db_instance" "bad" {
  publicly_accessible = true  # 絕不這樣做！
}

# PASS: 正確
resource "aws_db_instance" "good" {
  publicly_accessible = false
  vpc_security_group_ids = [aws_security_group.db.id]
}
```

## 資源

- [AWS Security Best Practices](https://aws.amazon.com/security/best-practices/)
- [CIS AWS Foundations Benchmark](https://www.cisecurity.org/benchmark/amazon_web_services)
- [Cloudflare Security Documentation](https://developers.cloudflare.com/security/)
- [OWASP Cloud Security](https://owasp.org/www-project-cloud-security/)
- [Terraform Security Best Practices](https://www.terraform.io/docs/cloud/guides/recommended-practices/)

**記住**：雲端錯誤設定是資料外洩的主要原因。單一暴露的 S3 bucket 或過於寬鬆的 IAM 政策可能危及你的整個基礎設施。總是遵循最小權限原則和深度防禦。
