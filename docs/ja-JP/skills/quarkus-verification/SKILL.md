---
name: quarkus-verification
description: Quarkusプロジェクト検証ループ：ビルド、静的分析、カバレッジ付きテスト、セキュリティスキャン、ネイティブコンパイル、本番環境またはPR前の差分レビュー。
origin: ECC
---

# Quarkus Verification Loop

PR、メジャー変更後、および本番前に実行します。

## When to Activate

- Quarkusサービスのプルリクエスト開始前
- メジャーリファクタリングまたは依存関係アップグレード後
- ステージング本番環境前のプリデプロイメント検証
- フル ビルド → リント → テスト → セキュリティスキャン → ネイティブコンパイルパイプライン実行
- テストカバレッジが閾値を満たす（80%以上）ことを検証
- ネイティブイメージ互換性テスト

## Phase 1: Build

```bash
# Maven
mvn clean verify -DskipTests

# Gradle
./gradlew clean assemble -x test
```

ビルド失敗時は停止してコンパイルエラーを修正します。

## Phase 2: Static Analysis

### Checkstyle, PMD, SpotBugs (Maven)

```bash
mvn checkstyle:check pmd:check spotbugs:check
```

### SonarQube (if configured)

```bash
mvn sonar:sonar \
  -Dsonar.projectKey=my-quarkus-project \
  -Dsonar.host.url=http://localhost:9000 \
  -Dsonar.login=${SONAR_TOKEN}
```

### Common Issues to Address

- 未使用のインポートまたは変数
- 複雑なメソッド（高い環状複雑度）
- 潜在的なnullポインター逆参照
- SpotBugsでフラグが立つセキュリティ問題

## Phase 3: Tests + Coverage

```bash
# 全テスト実行
mvn clean test

# カバレッジレポート生成
mvn jacoco:report

# カバレッジ閾値を強制（80%）
mvn jacoco:check

# またはGradleで
./gradlew test jacocoTestReport jacocoTestCoverageVerification
```

### Test Categories

#### Unit Tests
モック化された依存関係でサービスロジックテスト：

```java
@ExtendWith(MockitoExtension.class)
class UserServiceTest {
  @Mock UserRepository userRepository;
  @InjectMocks UserService userService;

  @Test
  void createUser_validInput_returnsUser() {
    var dto = new CreateUserDto("Alice", "alice@example.com");

    // Panacheのpersist()はvoid — doNothing + verifyを使用
    doNothing().when(userRepository).persist(any(User.class));

    User result = userService.create(dto);

    assertThat(result.name).isEqualTo("Alice");
    verify(userRepository).persist(any(User.class));
  }
}
```

#### Integration Tests
実データベース（Testcontainers）でテスト：

```java
@QuarkusTest
@QuarkusTestResource(PostgresTestResource.class)
class UserRepositoryIntegrationTest {

  @Inject
  UserRepository userRepository;

  @Test
  @Transactional
  void findByEmail_existingUser_returnsUser() {
    User user = new User();
    user.name = "Alice";
    user.email = "alice@example.com";
    userRepository.persist(user);

    Optional<User> found = userRepository.findByEmail("alice@example.com");

    assertThat(found).isPresent();
    assertThat(found.get().name).isEqualTo("Alice");
  }
}
```

#### API Tests
REST Assured でRESTエンドポイントテスト：

```java
@QuarkusTest
class UserResourceTest {

  @Test
  void createUser_validInput_returns201() {
    given()
        .contentType(ContentType.JSON)
        .body("""
            {"name": "Alice", "email": "alice@example.com"}
            """)
        .when().post("/api/users")
        .then()
        .statusCode(201)
        .body("name", equalTo("Alice"));
  }

  @Test
  void createUser_invalidEmail_returns400() {
    given()
        .contentType(ContentType.JSON)
        .body("""
            {"name": "Alice", "email": "invalid"}
            """)
        .when().post("/api/users")
        .then()
        .statusCode(400);
  }
}
```

### Coverage Report

詳細なカバレッジに対して`target/site/jacoco/index.html`を確認：
- 全行カバレッジ（目標：80%以上）
- ブランチカバレッジ（目標：70%以上）
- カバレッジされていない重要パスを特定

## Phase 4: Security Scanning

### Dependency Vulnerabilities (Maven)

```bash
mvn org.owasp:dependency-check-maven:check
```

CVEについて `target/dependency-check-report.html` を確認。

### Quarkus Security Audit

```bash
# 脆弱な拡張機能をチェック
mvn quarkus:audit

# 全拡張機能をリスト
mvn quarkus:list-extensions
```

### OWASP ZAP (API Security Testing)

```bash
docker run -t owasp/zap2docker-stable zap-api-scan.py \
  -t http://localhost:8080/q/openapi \
  -f openapi
```

### Common Security Checks

- [ ] 全シークレットが環境変数（コード内ではない）
- [ ] 全エンドポイントの入力検証
- [ ] 認証/認可設定済み
- [ ] CORS適切に設定
- [ ] セキュリティヘッダー設定
- [ ] BCryptでパスワードハッシュ化
- [ ] SQLインジェクション保護（パラメータ化クエリ）
- [ ] 公開エンドポイントのレート制限

## Phase 5: Native Compilation

GraalVM ネイティブイメージ互換性テスト：

```bash
# ネイティブ実行ファイルビルド
mvn package -Dnative

# またはコンテナで
mvn package -Dnative -Dquarkus.native.container-build=true

# ネイティブ実行ファイルテスト
./target/*-runner

# 基本スモークテスト実行
curl http://localhost:8080/q/health/live
curl http://localhost:8080/q/health/ready
```

### Native Image Troubleshooting

一般的な問題：
- **Reflection**: 動的クラスのリフレクション設定追加
- **Resources**: `quarkus.native.resources.includes`でリソース含める
- **JNI**: ネイティブライブラリ使用時JNIクラス登録

リフレクション設定例：
```java
@RegisterForReflection(targets = {MyDynamicClass.class})
public class ReflectionConfiguration {}
```

## Phase 6: Performance Testing

### Load Testing with K6

```javascript
// load-test.js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 100 },
    { duration: '30s', target: 0 },
  ],
};

export default function () {
  const res = http.get('http://localhost:8080/api/markets');
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 200ms': (r) => r.timings.duration < 200,
  });
}
```

実行：
```bash
k6 run load-test.js
```

### Metrics to Monitor

- レスポンスタイム（p50、p95、p99）
- スループット（リクエスト/秒）
- エラー率
- メモリ使用量
- CPU使用量

## Phase 7: Health Checks

```bash
# Liveness
curl http://localhost:8080/q/health/live

# Readiness
curl http://localhost:8080/q/health/ready

# 全ヘルスチェック
curl http://localhost:8080/q/health

# メトリクス（有効な場合）
curl http://localhost:8080/q/metrics
```

期待されるレスポンス：
```json
{
  "status": "UP",
  "checks": [
    {
      "name": "Database connection",
      "status": "UP"
    }
  ]
}
```

## Phase 8: Container Image Build

```bash
# コンテナイメージビルド
mvn package -Dquarkus.container-image.build=true

# または特定のレジストリで
mvn package \
  -Dquarkus.container-image.build=true \
  -Dquarkus.container-image.registry=docker.io \
  -Dquarkus.container-image.group=myorg \
  -Dquarkus.container-image.tag=1.0.0

# コンテナテスト
docker run -p 8080:8080 myorg/my-quarkus-app:1.0.0
```

### Container Security Scan

```bash
# Trivy
trivy image myorg/my-quarkus-app:1.0.0

# Grype
grype myorg/my-quarkus-app:1.0.0
```

## Phase 9: Configuration Validation

```bash
# 全設定プロパティをチェック
mvn quarkus:info

# 全設定ソースをリスト
curl http://localhost:8080/q/dev/io.quarkus.quarkus-vertx-http/config
```

### Environment-Specific Checks

- [ ] データベースURLが環境ごとに設定
- [ ] シークレットが外部化（Vault、環境変数）
- [ ] ロギングレベルが適切
- [ ] CORS origins が正しく設定
- [ ] レート制限を設定
- [ ] モニタリング/トレーシング有効化

## Phase 10: Documentation Review

- [ ] OpenAPI/Swaggerドキュメント最新（`/q/swagger-ui`）
- [ ] READMEにセットアップ説明有り
- [ ] APIの変更が文書化
- [ ] 互換性破壊の変更にマイグレーションガイド
- [ ] 設定プロパティが文書化

OpenAPI spec生成：
```bash
curl http://localhost:8080/q/openapi -o openapi.json
```

## Verification Checklist

### Code Quality
- [ ] ビルドが警告なしで成功
- [ ] 静的分析がクリーン（高/中レベル問題なし）
- [ ] コードがチーム規則に従う
- [ ] PRにコメント・TODOなし

### Testing
- [ ] 全テスト成功
- [ ] コードカバレッジ ≥ 80%
- [ ] 実データベースでの統合テスト
- [ ] セキュリティテスト成功
- [ ] パフォーマンスが許容範囲内

### Security
- [ ] 依存関係の脆弱性なし
- [ ] 認証/認可テスト済み
- [ ] 入力検証が完全
- [ ] シークレットがソースコードに無い
- [ ] セキュリティヘッダー設定済み

### Deployment
- [ ] ネイティブコンパイル成功
- [ ] コンテナイメージビルド成功
- [ ] ヘルスチェック正しく動作
- [ ] ターゲット環境の設定が有効

### Native Image
- [ ] ネイティブ実行ファイルビルド成功
- [ ] ネイティブテスト成功
- [ ] 起動時間 < 100ms
- [ ] メモリフットプリント許容範囲

## Automated Verification Script

```bash
#!/bin/bash
set -e

echo "=== Phase 1: Build ==="
mvn clean verify -DskipTests

echo "=== Phase 2: Static Analysis ==="
mvn checkstyle:check pmd:check spotbugs:check

echo "=== Phase 3: Tests + Coverage ==="
mvn test jacoco:report jacoco:check

echo "=== Phase 4: Security Scan ==="
mvn org.owasp:dependency-check-maven:check

echo "=== Phase 5: Native Compilation ==="
mvn package -Dnative -Dquarkus.native.container-build=true

echo "=== All Phases Complete ==="
echo "Review reports:"
echo "  - Coverage: target/site/jacoco/index.html"
echo "  - Security: target/dependency-check-report.html"
echo "  - Native: target/*-runner"
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Verification

on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Set up JDK 21
        uses: actions/setup-java@v3
        with:
          java-version: '21'
          distribution: 'temurin'

      - name: Cache Maven packages
        uses: actions/cache@v3
        with:
          path: ~/.m2
          key: ${{ runner.os }}-m2-${{ hashFiles('**/pom.xml') }}

      - name: Build
        run: mvn clean verify -DskipTests

      - name: Test with Coverage
        run: mvn test jacoco:report jacoco:check

      - name: Security Scan
        run: mvn org.owasp:dependency-check-maven:check

      - name: Upload Coverage
        uses: codecov/codecov-action@v3
        with:
          files: target/site/jacoco/jacoco.xml
```

## Best Practices

- 全PRの前に検証ループ実行
- CI/CDパイプラインで自動化
- 問題は即座に修正、債務を溜めない
- カバレッジを80%以上に保つ
- 依存関係を定期的にアップデート
- 定期的にネイティブコンパイルテスト
- パフォーマンストレンドを監視
- 互換性破壊の変更を文書化
- セキュリティスキャン結果をレビュー
- 環境ごとに設定を検証
