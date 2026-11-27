| name | description |
|------|-------------|
| cloud-infrastructure-security | 在部署到云平台、配置基础设施、管理IAM策略、设置日志记录/监控或实现CI/CD流水线时使用此技能。提供符合最佳实践的云安全检查清单。 |

# 云与基础设施安全技能

此技能确保云基础设施、CI/CD流水线和部署配置遵循安全最佳实践并符合行业标准。

## 何时激活

* 将应用程序部署到云平台（AWS、Vercel、Railway、Cloudflare）
* 配置IAM角色和权限
* 设置CI/CD流水线
* 实施基础设施即代码（Terraform、CloudFormation）
* 配置日志记录和监控
* 在云环境中管理密钥
* 设置CDN和边缘安全
* 实施灾难恢复和备份策略

## 云安全检查清单

### 1. IAM 与访问控制

#### 最小权限原则

```yaml
# PASS: CORRECT: Minimal permissions
iam_role:
  permissions:
    - s3:GetObject  # Only read access
    - s3:ListBucket
  resources:
    - arn:aws:s3:::my-bucket/*  # Specific bucket only

# FAIL: WRONG: Overly broad permissions
iam_role:
  permissions:
    - s3:*  # All S3 actions
  resources:
    - "*"  # All resources
```

#### 多因素认证 (MFA)

```bash
# ALWAYS enable MFA for root/admin accounts
aws iam enable-mfa-device \
  --user-name admin \
  --serial-number arn:aws:iam::123456789:mfa/admin \
  --authentication-code1 123456 \
  --authentication-code2 789012
```

#### 验证步骤

* \[ ] 生产环境中未使用根账户
* \[ ] 所有特权账户已启用MFA
* \[ ] 服务账户使用角色，而非长期凭证
* \[ ] IAM策略遵循最小权限原则
* \[ ] 定期进行访问审查
* \[ ] 未使用的凭证已轮换或移除

### 2. 密钥管理

#### 云密钥管理器

```typescript
// PASS: CORRECT: Use cloud secrets manager
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManager({ region: 'us-east-1' });
const secret = await client.getSecretValue({ SecretId: 'prod/api-key' });
const apiKey = JSON.parse(secret.SecretString).key;

// FAIL: WRONG: Hardcoded or in environment variables only
const apiKey = process.env.API_KEY; // Not rotated, not audited
```

#### 密钥轮换

```bash
# Set up automatic rotation for database credentials
aws secretsmanager rotate-secret \
  --secret-id prod/db-password \
  --rotation-lambda-arn arn:aws:lambda:region:account:function:rotate \
  --rotation-rules AutomaticallyAfterDays=30
```

#### 验证步骤

* \[ ] 所有密钥存储在云密钥管理器（AWS Secrets Manager、Vercel Secrets）中
* \[ ] 数据库凭证已启用自动轮换
* \[ ] API密钥至少每季度轮换一次
* \[ ] 代码、日志或错误消息中没有密钥
* \[ ] 密钥访问已启用审计日志记录

### 3. 网络安全

#### VPC 和防火墙配置

```terraform
# PASS: CORRECT: Restricted security group
resource "aws_security_group" "app" {
  name = "app-sg"

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]  # Internal VPC only
  }

  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]  # Only HTTPS outbound
  }
}

# FAIL: WRONG: Open to the internet
resource "aws_security_group" "bad" {
  ingress {
    from_port   = 0
    to_port     = 65535
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]  # All ports, all IPs!
  }
}
```

#### 验证步骤

* \[ ] 数据库未公开访问
* \[ ] SSH/RDP端口仅限VPN/堡垒机访问
* \[ ] 安全组遵循最小权限原则
* \[ ] 网络ACL已配置
* \[ ] VPC流日志已启用

### 4. 日志记录与监控

#### CloudWatch/日志记录配置

```typescript
// PASS: CORRECT: Comprehensive logging
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
        // Never log sensitive data
      })
    }]
  });
};
```

#### 验证步骤

* \[ ] 所有服务已启用CloudWatch/日志记录
* \[ ] 失败的身份验证尝试已记录
* \[ ] 管理员操作已审计
* \[ ] 日志保留期已配置（合规要求90天以上）
* \[ ] 为可疑活动配置了警报
* \[ ] 日志已集中存储且防篡改

### 5. CI/CD 流水线安全

#### 安全流水线配置

```yaml
# PASS: CORRECT: Secure GitHub Actions workflow
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read  # Minimal permissions

    steps:
      - uses: actions/checkout@v4

      # Scan for secrets
      - name: Secret scanning
        uses: trufflesecurity/trufflehog@main

      # Dependency audit
      - name: Audit dependencies
        run: npm audit --audit-level=high

      # Use OIDC, not long-lived tokens
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789:role/GitHubActionsRole
          aws-region: us-east-1
```

#### 供应链安全

```json
// package.json - Use lock files and integrity checks
{
  "scripts": {
    "install": "npm ci",  // Use ci for reproducible builds
    "audit": "npm audit --audit-level=moderate",
    "check": "npm outdated"
  }
}
```

#### 验证步骤

* \[ ] 使用OIDC而非长期凭证
* \[ ] 流水线中进行密钥扫描
* \[ ] 依赖项漏洞扫描
* \[ ] 容器镜像扫描（如适用）
* \[ ] 分支保护规则已强制执行
* \[ ] 合并前需要代码审查
* \[ ] 已强制执行签名提交

### 6. Cloudflare 与 CDN 安全

#### Cloudflare 安全配置

```typescript
// PASS: CORRECT: Cloudflare Workers with security headers
export default {
  async fetch(request: Request): Promise<Response> {
    const response = await fetch(request);

    // Add security headers
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

#### WAF 规则

```bash
# Enable Cloudflare WAF managed rules
# - OWASP Core Ruleset
# - Cloudflare Managed Ruleset
# - Rate limiting rules
# - Bot protection
```

#### 验证步骤

* \[ ] WAF已启用并配置OWASP规则
* \[ ] 已配置速率限制
* \[ ] 机器人防护已激活
* \[ ] DDoS防护已启用
* \[ ] 安全标头已配置
* \[ ] SSL/TLS严格模式已启用

### 7. 备份与灾难恢复

#### 自动化备份

```terraform
# PASS: CORRECT: Automated RDS backups
resource "aws_db_instance" "main" {
  allocated_storage     = 20
  engine               = "postgres"

  backup_retention_period = 30  # 30 days retention
  backup_window          = "03:00-04:00"
  maintenance_window     = "mon:04:00-mon:05:00"

  enabled_cloudwatch_logs_exports = ["postgresql"]

  deletion_protection = true  # Prevent accidental deletion
}
```

#### 验证步骤

* \[ ] 已配置自动化每日备份
* \[ ] 备份保留期符合合规要求
* \[ ] 已启用时间点恢复
* \[ ] 每季度执行备份测试
* \[ ] 灾难恢复计划已记录
* \[ ] RPO和RTO已定义并经过测试

## 部署前云安全检查清单

在任何生产云部署之前：

* \[ ] **IAM**：未使用根账户，已启用MFA，最小权限策略
* \[ ] **密钥**：所有密钥都在云密钥管理器中并已配置轮换
* \[ ] **网络**：安全组受限，无公开数据库
* \[ ] **日志记录**：已启用CloudWatch/日志记录并配置保留期
* \[ ] **监控**：为异常情况配置了警报
* \[ ] **CI/CD**：OIDC身份验证，密钥扫描，依赖项审计
* \[ ] **CDN/WAF**：Cloudflare WAF已启用并配置OWASP规则
* \[ ] **加密**：静态和传输中的数据均已加密
* \[ ] **备份**：自动化备份并已测试恢复
* \[ ] **合规性**：满足GDPR/HIPAA要求（如适用）
* \[ ] **文档**：基础设施已记录，已创建操作手册
* \[ ] **事件响应**：已制定安全事件计划

## 常见云安全配置错误

### S3 存储桶暴露

```bash
# FAIL: WRONG: Public bucket
aws s3api put-bucket-acl --bucket my-bucket --acl public-read

# PASS: CORRECT: Private bucket with specific access
aws s3api put-bucket-acl --bucket my-bucket --acl private
aws s3api put-bucket-policy --bucket my-bucket --policy file://policy.json
```

### RDS 公开访问

```terraform
# FAIL: WRONG
resource "aws_db_instance" "bad" {
  publicly_accessible = true  # NEVER do this!
}

# PASS: CORRECT
resource "aws_db_instance" "good" {
  publicly_accessible = false
  vpc_security_group_ids = [aws_security_group.db.id]
}
```

## 资源

* [AWS 安全最佳实践](https://aws.amazon.com/security/best-practices/)
* [CIS AWS 基础基准](https://www.cisecurity.org/benchmark/amazon_web_services)
* [Cloudflare 安全文档](https://developers.cloudflare.com/security/)
* [OWASP 云安全](https://owasp.org/www-project-cloud-security/)
* [Terraform 安全最佳实践](https://www.terraform.io/docs/cloud/guides/recommended-practices/)

**请记住**：云配置错误是数据泄露的主要原因。一个暴露的S3存储桶或一个权限过大的IAM策略就可能危及整个基础设施。始终遵循最小权限原则和深度防御策略。
