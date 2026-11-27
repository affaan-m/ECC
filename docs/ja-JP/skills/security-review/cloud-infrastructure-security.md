| name | description |
|------|-------------|
| cloud-infrastructure-security | クラウドプラットフォームへのデプロイ、インフラストラクチャの設定、IAMポリシーの管理、ロギング/モニタリングの設定、CI/CDパイプラインの実装時にこのスキルを使用します。ベストプラクティスに沿ったクラウドセキュリティチェックリストを提供します。 |

# クラウドおよびインフラストラクチャセキュリティスキル

このスキルは、クラウドインフラストラクチャ、CI/CDパイプライン、デプロイメント設定がセキュリティのベストプラクティスに従い、業界標準に準拠することを保証します。

## 有効化するタイミング

- クラウドプラットフォーム（AWS、Vercel、Railway、Cloudflare）へのアプリケーションのデプロイ
- IAMロールと権限の設定
- CI/CDパイプラインの設定
- インフラストラクチャをコードとして実装（Terraform、CloudFormation）
- ロギングとモニタリングの設定
- クラウド環境でのシークレット管理
- CDNとエッジセキュリティの設定
- 災害復旧とバックアップ戦略の実装

## クラウドセキュリティチェックリスト

### 1. IAMとアクセス制御

#### 最小権限の原則

```yaml
# PASS: 正解：最小限の権限
iam_role:
  permissions:
    - s3:GetObject  # 読み取りアクセスのみ
    - s3:ListBucket
  resources:
    - arn:aws:s3:::my-bucket/*  # 特定のバケットのみ

# FAIL: 誤り：過度に広範な権限
iam_role:
  permissions:
    - s3:*  # すべてのS3アクション
  resources:
    - "*"  # すべてのリソース
```

#### 多要素認証（MFA）

```bash
# 常にroot/adminアカウントでMFAを有効化
aws iam enable-mfa-device \
  --user-name admin \
  --serial-number arn:aws:iam::123456789:mfa/admin \
  --authentication-code1 123456 \
  --authentication-code2 789012
```

#### 検証ステップ

- [ ] 本番環境でrootアカウントを使用しない
- [ ] すべての特権アカウントでMFAを有効化
- [ ] サービスアカウントは長期資格情報ではなくロールを使用
- [ ] IAMポリシーは最小権限に従う
- [ ] 定期的なアクセスレビューを実施
- [ ] 未使用の資格情報をローテーションまたは削除

### 2. シークレット管理

#### クラウドシークレットマネージャー

```typescript
// PASS: 正解：クラウドシークレットマネージャーを使用
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManager({ region: 'us-east-1' });
const secret = await client.getSecretValue({ SecretId: 'prod/api-key' });
const apiKey = JSON.parse(secret.SecretString).key;

// FAIL: 誤り：ハードコードまたは環境変数のみ
const apiKey = process.env.API_KEY; // ローテーションされず、監査されない
```

#### シークレットローテーション

```bash
# データベース資格情報の自動ローテーションを設定
aws secretsmanager rotate-secret \
  --secret-id prod/db-password \
  --rotation-lambda-arn arn:aws:lambda:region:account:function:rotate \
  --rotation-rules AutomaticallyAfterDays=30
```

#### 検証ステップ

- [ ] すべてのシークレットをクラウドシークレットマネージャーに保存（AWS Secrets Manager、Vercel Secrets）
- [ ] データベース資格情報の自動ローテーションを有効化
- [ ] APIキーを少なくとも四半期ごとにローテーション
- [ ] コード、ログ、エラーメッセージにシークレットなし
- [ ] シークレットアクセスの監査ログを有効化

### 3. ネットワークセキュリティ

#### VPCとファイアウォール設定

```terraform
# PASS: 正解：制限されたセキュリティグループ
resource "aws_security_group" "app" {
  name = "app-sg"

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]  # 内部VPCのみ
  }

  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]  # HTTPS送信のみ
  }
}

# FAIL: 誤り：インターネットに公開
resource "aws_security_group" "bad" {
  ingress {
    from_port   = 0
    to_port     = 65535
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]  # すべてのポート、すべてのIP！
  }
}
```

#### 検証ステップ

- [ ] データベースは公開アクセス不可
- [ ] SSH/RDPポートはVPN/bastionのみに制限
- [ ] セキュリティグループは最小権限に従う
- [ ] ネットワークACLを設定
- [ ] VPCフローログを有効化

### 4. ロギングとモニタリング

#### CloudWatch/ロギング設定

```typescript
// PASS: 正解：包括的なロギング
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
        // 機密データをログに記録しない
      })
    }]
  });
};
```

#### 検証ステップ

- [ ] すべてのサービスでCloudWatch/ロギングを有効化
- [ ] 失敗した認証試行をログに記録
- [ ] 管理者アクションを監査
- [ ] ログ保持を設定（コンプライアンスのため90日以上）
- [ ] 疑わしいアクティビティのアラートを設定
- [ ] ログを一元化し、改ざん防止

### 5. CI/CDパイプラインセキュリティ

#### 安全なパイプライン設定

```yaml
# PASS: 正解：安全なGitHub Actionsワークフロー
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read  # 最小限の権限

    steps:
      - uses: actions/checkout@v4

      # シークレットをスキャン
      - name: Secret scanning
        uses: trufflesecurity/trufflehog@main

      # 依存関係監査
      - name: Audit dependencies
        run: npm audit --audit-level=high

      # 長期トークンではなくOIDCを使用
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789:role/GitHubActionsRole
          aws-region: us-east-1
```

#### サプライチェーンセキュリティ

```json
// package.json - ロックファイルと整合性チェックを使用
{
  "scripts": {
    "install": "npm ci",  // 再現可能なビルドにciを使用
    "audit": "npm audit --audit-level=moderate",
    "check": "npm outdated"
  }
}
```

#### 検証ステップ

- [ ] 長期資格情報ではなくOIDCを使用
- [ ] パイプラインでシークレットスキャン
- [ ] 依存関係の脆弱性スキャン
- [ ] コンテナイメージスキャン（該当する場合）
- [ ] ブランチ保護ルールを強制
- [ ] マージ前にコードレビューが必要
- [ ] 署名付きコミットを強制

### 6. CloudflareとCDNセキュリティ

#### Cloudflareセキュリティ設定

```typescript
// PASS: 正解：セキュリティヘッダー付きCloudflare Workers
export default {
  async fetch(request: Request): Promise<Response> {
    const response = await fetch(request);

    // セキュリティヘッダーを追加
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

#### WAFルール

```bash
# Cloudflare WAF管理ルールを有効化
# - OWASP Core Ruleset
# - Cloudflare Managed Ruleset
# - レート制限ルール
# - ボット保護
```

#### 検証ステップ

- [ ] OWASPルール付きWAFを有効化
- [ ] レート制限を設定
- [ ] ボット保護を有効化
- [ ] DDoS保護を有効化
- [ ] セキュリティヘッダーを設定
- [ ] SSL/TLS厳格モードを有効化

### 7. バックアップと災害復旧

#### 自動バックアップ

```terraform
# PASS: 正解：自動RDSバックアップ
resource "aws_db_instance" "main" {
  allocated_storage     = 20
  engine               = "postgres"

  backup_retention_period = 30  # 30日間保持
  backup_window          = "03:00-04:00"
  maintenance_window     = "mon:04:00-mon:05:00"

  enabled_cloudwatch_logs_exports = ["postgresql"]

  deletion_protection = true  # 偶発的な削除を防止
}
```

#### 検証ステップ

- [ ] 自動日次バックアップを設定
- [ ] バックアップ保持がコンプライアンス要件を満たす
- [ ] ポイントインタイムリカバリを有効化
- [ ] 四半期ごとにバックアップテストを実施
- [ ] 災害復旧計画を文書化
- [ ] RPOとRTOを定義してテスト

## デプロイ前クラウドセキュリティチェックリスト

すべての本番クラウドデプロイメントの前に：

- [ ] **IAM**：rootアカウントを使用しない、MFAを有効化、最小権限ポリシー
- [ ] **シークレット**：すべてのシークレットをローテーション付きクラウドシークレットマネージャーに
- [ ] **ネットワーク**：セキュリティグループを制限、公開データベースなし
- [ ] **ロギング**：保持付きCloudWatch/ロギングを有効化
- [ ] **モニタリング**：異常のアラートを設定
- [ ] **CI/CD**：OIDC認証、シークレットスキャン、依存関係監査
- [ ] **CDN/WAF**：OWASPルール付きCloudflare WAFを有効化
- [ ] **暗号化**：静止時および転送中のデータを暗号化
- [ ] **バックアップ**：テスト済みリカバリ付き自動バックアップ
- [ ] **コンプライアンス**：GDPR/HIPAA要件を満たす（該当する場合）
- [ ] **ドキュメント**：インフラストラクチャを文書化、ランブックを作成
- [ ] **インシデント対応**：セキュリティインシデント計画を配置

## 一般的なクラウドセキュリティ設定ミス

### S3バケットの露出

```bash
# FAIL: 誤り：公開バケット
aws s3api put-bucket-acl --bucket my-bucket --acl public-read

# PASS: 正解：特定のアクセス付きプライベートバケット
aws s3api put-bucket-acl --bucket my-bucket --acl private
aws s3api put-bucket-policy --bucket my-bucket --policy file://policy.json
```

### RDS公開アクセス

```terraform
# FAIL: 誤り
resource "aws_db_instance" "bad" {
  publicly_accessible = true  # 絶対にこれをしない！
}

# PASS: 正解
resource "aws_db_instance" "good" {
  publicly_accessible = false
  vpc_security_group_ids = [aws_security_group.db.id]
}
```

## リソース

- [AWS Security Best Practices](https://aws.amazon.com/security/best-practices/)
- [CIS AWS Foundations Benchmark](https://www.cisecurity.org/benchmark/amazon_web_services)
- [Cloudflare Security Documentation](https://developers.cloudflare.com/security/)
- [OWASP Cloud Security](https://owasp.org/www-project-cloud-security/)
- [Terraform Security Best Practices](https://www.terraform.io/docs/cloud/guides/recommended-practices/)

**覚えておいてください**：クラウドの設定ミスはデータ侵害の主要な原因です。1つの露出したS3バケットまたは過度に許容されたIAMポリシーは、インフラストラクチャ全体を危険にさらす可能性があります。常に最小権限の原則と多層防御に従ってください。
