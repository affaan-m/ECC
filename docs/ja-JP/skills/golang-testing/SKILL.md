---
name: golang-testing
description: テスト駆動開発とGoコードの高品質を保証するための包括的なテスト戦略。
---

# Go テスト

テスト駆動開発(TDD)とGoコードの高品質を保証するための包括的なテスト戦略。

## いつ有効化するか

- 新しいGoコードを書くとき
- Goコードをレビューするとき
- 既存のテストを改善するとき
- テストカバレッジを向上させるとき
- デバッグとバグ修正時

## 核となる原則

### 1. テスト駆動開発(TDD)ワークフロー

失敗するテストを書き、実装し、リファクタリングするサイクルに従います。

```go
// 1. テストを書く（失敗）
func TestCalculateTotal(t *testing.T) {
    total := CalculateTotal([]float64{10.0, 20.0, 30.0})
    want := 60.0
    if total != want {
        t.Errorf("got %f, want %f", total, want)
    }
}

// 2. 実装する（テストを通す）
func CalculateTotal(prices []float64) float64 {
    var total float64
    for _, price := range prices {
        total += price
    }
    return total
}

// 3. リファクタリング
// テストを壊さずにコードを改善
```

### 2. テーブル駆動テスト

複数のケースを体系的にテストします。

```go
func TestAdd(t *testing.T) {
    tests := []struct {
        name string
        a, b int
        want int
    }{
        {"positive numbers", 2, 3, 5},
        {"negative numbers", -2, -3, -5},
        {"mixed signs", -2, 3, 1},
        {"zeros", 0, 0, 0},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := Add(tt.a, tt.b)
            if got != tt.want {
                t.Errorf("Add(%d, %d) = %d; want %d",
                    tt.a, tt.b, got, tt.want)
            }
        })
    }
}
```

### 3. サブテスト

サブテストを使用した論理的なテストの構成。

```go
func TestUser(t *testing.T) {
    t.Run("validation", func(t *testing.T) {
        t.Run("empty email", func(t *testing.T) {
            user := User{Email: ""}
            if err := user.Validate(); err == nil {
                t.Error("expected validation error")
            }
        })

        t.Run("valid email", func(t *testing.T) {
            user := User{Email: "test@example.com"}
            if err := user.Validate(); err != nil {
                t.Errorf("unexpected error: %v", err)
            }
        })
    })

    t.Run("serialization", func(t *testing.T) {
        // 別のテストグループ
    })
}
```

## テスト構成

### ファイル構成

```text
mypackage/
├── user.go
├── user_test.go          # ユニットテスト
├── integration_test.go   # 統合テスト
├── testdata/             # テストフィクスチャ
│   ├── valid_user.json
│   └── invalid_user.json
└── export_test.go        # 内部テスト用の非公開エクスポート
```

### テストパッケージ

```go
// user_test.go - 同じパッケージ（ホワイトボックステスト）
package user

func TestInternalFunction(t *testing.T) {
    // 内部をテストできる
}

// user_external_test.go - 外部パッケージ（ブラックボックステスト）
package user_test

import "myapp/user"

func TestPublicAPI(t *testing.T) {
    // 公開APIのみをテスト
}
```

## アサーションとヘルパー

### 基本的なアサーション

```go
func TestBasicAssertions(t *testing.T) {
    // 等価性
    got := Calculate()
    want := 42
    if got != want {
        t.Errorf("got %d, want %d", got, want)
    }

    // エラーチェック
    _, err := Process()
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }

    // nil チェック
    result := GetResult()
    if result == nil {
        t.Fatal("expected non-nil result")
    }
}
```

### カスタムヘルパー関数

```go
// ヘルパーとしてマーク（スタックトレースに表示されない）
func assertEqual(t *testing.T, got, want interface{}) {
    t.Helper()
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}

func assertNoError(t *testing.T, err error) {
    t.Helper()
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
}

// 使用例
func TestWithHelpers(t *testing.T) {
    result, err := Process()
    assertNoError(t, err)
    assertEqual(t, result.Status, "success")
}
```

### ディープ等価性チェック

```go
import "reflect"

func assertDeepEqual(t *testing.T, got, want interface{}) {
    t.Helper()
    if !reflect.DeepEqual(got, want) {
        t.Errorf("got %+v, want %+v", got, want)
    }
}

func TestStructEquality(t *testing.T) {
    got := User{Name: "Alice", Age: 30}
    want := User{Name: "Alice", Age: 30}
    assertDeepEqual(t, got, want)
}
```

## モッキングとスタブ

### インターフェースベースのモック

```go
// 本番コード
type UserStore interface {
    GetUser(id string) (*User, error)
    SaveUser(user *User) error
}

type UserService struct {
    store UserStore
}

// テストコード
type MockUserStore struct {
    users map[string]*User
    err   error
}

func (m *MockUserStore) GetUser(id string) (*User, error) {
    if m.err != nil {
        return nil, m.err
    }
    return m.users[id], nil
}

func (m *MockUserStore) SaveUser(user *User) error {
    if m.err != nil {
        return m.err
    }
    m.users[user.ID] = user
    return nil
}

// テスト
func TestUserService(t *testing.T) {
    mock := &MockUserStore{
        users: make(map[string]*User),
    }
    service := &UserService{store: mock}

    // サービスをテスト...
}
```

### 時間のモック

```go
// プロダクションコード - 時間を注入可能にする
type TimeProvider interface {
    Now() time.Time
}

type RealTime struct{}

func (RealTime) Now() time.Time {
    return time.Now()
}

type Service struct {
    time TimeProvider
}

// テストコード
type MockTime struct {
    current time.Time
}

func (m MockTime) Now() time.Time {
    return m.current
}

func TestTimeDependent(t *testing.T) {
    mockTime := MockTime{
        current: time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC),
    }
    service := &Service{time: mockTime}

    // 固定時間でテスト...
}
```

### HTTP クライアントのモック

```go
type HTTPClient interface {
    Do(req *http.Request) (*http.Response, error)
}

type MockHTTPClient struct {
    response *http.Response
    err      error
}

func (m *MockHTTPClient) Do(req *http.Request) (*http.Response, error) {
    return m.response, m.err
}

func TestAPICall(t *testing.T) {
    mockClient := &MockHTTPClient{
        response: &http.Response{
            StatusCode: 200,
            Body:       io.NopCloser(strings.NewReader(`{"status":"ok"}`)),
        },
    }

    api := &APIClient{client: mockClient}
    // APIクライアントをテスト...
}
```

## HTTPハンドラーのテスト

### httptest の使用

```go
func TestHandler(t *testing.T) {
    handler := http.HandlerFunc(MyHandler)

    req := httptest.NewRequest("GET", "/users/123", nil)
    rec := httptest.NewRecorder()

    handler.ServeHTTP(rec, req)

    // ステータスコードをチェック
    if rec.Code != http.StatusOK {
        t.Errorf("got status %d, want %d", rec.Code, http.StatusOK)
    }

    // レスポンスボディをチェック
    var response map[string]interface{}
    if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
        t.Fatalf("failed to decode response: %v", err)
    }

    if response["id"] != "123" {
        t.Errorf("got id %v, want 123", response["id"])
    }
}
```

### ミドルウェアのテスト

```go
func TestAuthMiddleware(t *testing.T) {
    // ダミーハンドラー
    nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
    })

    // ミドルウェアでラップ
    handler := AuthMiddleware(nextHandler)

    tests := []struct {
        name       string
        token      string
        wantStatus int
    }{
        {"valid token", "valid-token", http.StatusOK},
        {"invalid token", "invalid", http.StatusUnauthorized},
        {"no token", "", http.StatusUnauthorized},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            req := httptest.NewRequest("GET", "/", nil)
            if tt.token != "" {
                req.Header.Set("Authorization", "Bearer "+tt.token)
            }
            rec := httptest.NewRecorder()

            handler.ServeHTTP(rec, req)

            if rec.Code != tt.wantStatus {
                t.Errorf("got status %d, want %d", rec.Code, tt.wantStatus)
            }
        })
    }
}
```

### テストサーバー

```go
func TestAPIIntegration(t *testing.T) {
    // テストサーバーを作成
    server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        json.NewEncoder(w).Encode(map[string]string{
            "message": "hello",
        })
    }))
    defer server.Close()

    // 実際のHTTPリクエストを行う
    resp, err := http.Get(server.URL)
    if err != nil {
        t.Fatalf("request failed: %v", err)
    }
    defer resp.Body.Close()

    // レスポンスを検証
    var result map[string]string
    json.NewDecoder(resp.Body).Decode(&result)

    if result["message"] != "hello" {
        t.Errorf("got %s, want hello", result["message"])
    }
}
```

## データベーステスト

### トランザクションを使用したテストの分離

```go
func TestUserRepository(t *testing.T) {
    db := setupTestDB(t)
    defer db.Close()

    tests := []struct {
        name string
        fn   func(*testing.T, *sql.DB)
    }{
        {"create user", testCreateUser},
        {"find user", testFindUser},
        {"update user", testUpdateUser},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            tx, err := db.Begin()
            if err != nil {
                t.Fatal(err)
            }
            defer tx.Rollback() // テスト後にロールバック

            tt.fn(t, tx)
        })
    }
}
```

### テストフィクスチャ

```go
func setupTestDB(t *testing.T) *sql.DB {
    t.Helper()

    db, err := sql.Open("postgres", "postgres://localhost/test")
    if err != nil {
        t.Fatalf("failed to connect: %v", err)
    }

    // スキーマを移行
    if err := runMigrations(db); err != nil {
        t.Fatalf("migrations failed: %v", err)
    }

    return db
}

func seedTestData(t *testing.T, db *sql.DB) {
    t.Helper()

    fixtures := []string{
        `INSERT INTO users (id, email) VALUES ('1', 'test@example.com')`,
        `INSERT INTO posts (id, user_id, title) VALUES ('1', '1', 'Test Post')`,
    }

    for _, query := range fixtures {
        if _, err := db.Exec(query); err != nil {
            t.Fatalf("failed to seed data: %v", err)
        }
    }
}
```

## ベンチマーク

### 基本的なベンチマーク

```go
func BenchmarkCalculation(b *testing.B) {
    for i := 0; i < b.N; i++ {
        Calculate(100)
    }
}

// メモリ割り当てを報告
func BenchmarkWithAllocs(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        ProcessData([]byte("test data"))
    }
}
```

### サブベンチマーク

```go
func BenchmarkEncoding(b *testing.B) {
    data := generateTestData()

    b.Run("json", func(b *testing.B) {
        b.ReportAllocs()
        for i := 0; i < b.N; i++ {
            json.Marshal(data)
        }
    })

    b.Run("gob", func(b *testing.B) {
        b.ReportAllocs()
        var buf bytes.Buffer
        enc := gob.NewEncoder(&buf)
        b.ResetTimer()
        for i := 0; i < b.N; i++ {
            enc.Encode(data)
            buf.Reset()
        }
    })
}
```

### ベンチマーク比較

```go
// 実行: go test -bench=. -benchmem
func BenchmarkStringConcat(b *testing.B) {
    b.Run("operator", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            _ = "hello" + " " + "world"
        }
    })

    b.Run("fmt.Sprintf", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            _ = fmt.Sprintf("%s %s", "hello", "world")
        }
    })

    b.Run("strings.Builder", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            var sb strings.Builder
            sb.WriteString("hello")
            sb.WriteString(" ")
            sb.WriteString("world")
            _ = sb.String()
        }
    })
}
```

## ファジングテスト

### 基本的なファズテスト（Go 1.18+）

```go
func FuzzParseInput(f *testing.F) {
    // シードコーパス
    f.Add("hello")
    f.Add("world")
    f.Add("123")

    f.Fuzz(func(t *testing.T, input string) {
        // パースがパニックしないことを確認
        result, err := ParseInput(input)

        // エラーがあっても、nilでないか一貫性があることを確認
        if err == nil && result == nil {
            t.Error("got nil result with no error")
        }
    })
}
```

### より複雑なファジング

```go
func FuzzJSONParsing(f *testing.F) {
    f.Add([]byte(`{"name":"test","age":30}`))
    f.Add([]byte(`{"name":"","age":0}`))

    f.Fuzz(func(t *testing.T, data []byte) {
        var user User
        err := json.Unmarshal(data, &user)

        // JSONがデコードされる場合、再度エンコードできるべき
        if err == nil {
            _, err := json.Marshal(user)
            if err != nil {
                t.Errorf("marshal failed after successful unmarshal: %v", err)
            }
        }
    })
}
```

## テストカバレッジ

### カバレッジの実行と表示

```bash
# カバレッジを実行してHTMLレポートを生成
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out -o coverage.html

# パッケージごとのカバレッジを表示
go test -cover ./...

# 詳細なカバレッジ
go test -coverprofile=coverage.out -covermode=atomic ./...
```

### カバレッジのベストプラクティス

```go
// Good: テスタブルなコード
func ProcessData(data []byte) (Result, error) {
    if len(data) == 0 {
        return Result{}, ErrEmptyData
    }

    // 各分岐をテスト可能
    if isValid(data) {
        return parseValid(data)
    }
    return parseInvalid(data)
}

// 対応するテストが全分岐をカバー
func TestProcessData(t *testing.T) {
    tests := []struct {
        name    string
        data    []byte
        wantErr bool
    }{
        {"empty data", []byte{}, true},
        {"valid data", []byte("valid"), false},
        {"invalid data", []byte("invalid"), false},
    }
    // ...
}
```

## 統合テスト

### ビルドタグの使用

```go
//go:build integration
// +build integration

package myapp_test

import "testing"

func TestDatabaseIntegration(t *testing.T) {
    // 実際のDBを必要とするテスト
}
```

```bash
# 統合テストを実行
go test -tags=integration ./...

# 統合テストを除外
go test ./...
```

### テストコンテナの使用

```go
import "github.com/testcontainers/testcontainers-go"

func setupPostgres(t *testing.T) *sql.DB {
    ctx := context.Background()

    req := testcontainers.ContainerRequest{
        Image:        "postgres:15",
        ExposedPorts: []string{"5432/tcp"},
        Env: map[string]string{
            "POSTGRES_PASSWORD": "test",
            "POSTGRES_DB":       "testdb",
        },
    }

    container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
        ContainerRequest: req,
        Started:          true,
    })
    if err != nil {
        t.Fatal(err)
    }

    t.Cleanup(func() {
        container.Terminate(ctx)
    })

    // コンテナに接続
    // ...
    return db
}
```

## テストの並列化

### 並列テスト

```go
func TestParallel(t *testing.T) {
    tests := []struct {
        name string
        fn   func(*testing.T)
    }{
        {"test1", testCase1},
        {"test2", testCase2},
        {"test3", testCase3},
    }

    for _, tt := range tests {
        tt := tt // ループ変数をキャプチャ
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel() // このテストを並列実行
            tt.fn(t)
        })
    }
}
```

### 並列実行の制御

```go
func TestWithResourceLimit(t *testing.T) {
    // 同時に5つのテストのみ
    sem := make(chan struct{}, 5)

    tests := generateManyTests()

    for _, tt := range tests {
        tt := tt
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel()

            sem <- struct{}{}        // 獲得
            defer func() { <-sem }() // 解放

            tt.fn(t)
        })
    }
}
```

## Goツール統合

### テストコマンド

```bash
# 基本テスト
go test ./...
go test -v ./...                    # 詳細出力
go test -run TestSpecific ./...     # 特定のテストを実行

# カバレッジ
go test -cover ./...
go test -coverprofile=coverage.out ./...

# レースコンディション
go test -race ./...

# ベンチマーク
go test -bench=. ./...
go test -bench=. -benchmem ./...
go test -bench=. -cpuprofile=cpu.prof ./...

# ファジング
go test -fuzz=FuzzTest

# 統合テスト
go test -tags=integration ./...

# JSONフォーマット（CI統合用）
go test -json ./...
```

### テスト設定

```bash
# テストタイムアウト
go test -timeout 30s ./...

# 短時間テスト（長時間テストをスキップ）
go test -short ./...

# ビルドキャッシュのクリア
go clean -testcache
go test ./...
```

## ベストプラクティス

### DRY（Don't Repeat Yourself）原則

```go
// Good: テーブル駆動テストで繰り返しを削減
func TestValidation(t *testing.T) {
    tests := []struct {
        input string
        valid bool
    }{
        {"valid@email.com", true},
        {"invalid-email", false},
        {"", false},
    }

    for _, tt := range tests {
        t.Run(tt.input, func(t *testing.T) {
            err := Validate(tt.input)
            if (err == nil) != tt.valid {
                t.Errorf("Validate(%q) error = %v, want valid = %v",
                    tt.input, err, tt.valid)
            }
        })
    }
}
```

### テストデータの分離

```go
// Good: テストデータを testdata/ ディレクトリに配置
func TestLoadConfig(t *testing.T) {
    data, err := os.ReadFile("testdata/config.json")
    if err != nil {
        t.Fatal(err)
    }

    config, err := ParseConfig(data)
    // ...
}
```

### クリーンアップの使用

```go
func TestWithCleanup(t *testing.T) {
    // リソースを設定
    file, err := os.CreateTemp("", "test")
    if err != nil {
        t.Fatal(err)
    }

    // クリーンアップを登録（deferに似ているが、サブテストで動作）
    t.Cleanup(func() {
        os.Remove(file.Name())
    })

    // テストを続ける...
}
```

### エラーメッセージの明確化

```go
// Bad: 不明確なエラー
if result != expected {
    t.Error("wrong result")
}

// Good: コンテキスト付きエラー
if result != expected {
    t.Errorf("Calculate(%d) = %d; want %d", input, result, expected)
}

// Better: ヘルパー関数の使用
assertEqual(t, result, expected, "Calculate(%d)", input)
```

## 避けるべきアンチパターン

```go
// Bad: 外部状態に依存
func TestBadDependency(t *testing.T) {
    result := GetUserFromDatabase("123") // 実際のDBを使用
    // テストが壊れやすく遅い
}

// Good: 依存を注入
func TestGoodDependency(t *testing.T) {
    mockDB := &MockDatabase{
        users: map[string]User{"123": {ID: "123"}},
    }
    result := GetUser(mockDB, "123")
}

// Bad: テスト間で状態を共有
var sharedCounter int

func TestShared1(t *testing.T) {
    sharedCounter++
    // テストの順序に依存
}

// Good: 各テストを独立させる
func TestIndependent(t *testing.T) {
    counter := 0
    counter++
    // 他のテストに影響しない
}

// Bad: エラーを無視
func TestIgnoreError(t *testing.T) {
    result, _ := Process()
    if result != expected {
        t.Error("wrong result")
    }
}

// Good: エラーをチェック
func TestCheckError(t *testing.T) {
    result, err := Process()
    if err != nil {
        t.Fatalf("Process() error = %v", err)
    }
    if result != expected {
        t.Errorf("got %v, want %v", result, expected)
    }
}
```

## クイックリファレンス

| コマンド/パターン | 目的 |
|--------------|---------|
| `go test ./...` | すべてのテストを実行 |
| `go test -v` | 詳細出力 |
| `go test -cover` | カバレッジレポート |
| `go test -race` | レースコンディション検出 |
| `go test -bench=.` | ベンチマークを実行 |
| `t.Run()` | サブテスト |
| `t.Helper()` | テストヘルパー関数 |
| `t.Parallel()` | テストを並列実行 |
| `t.Cleanup()` | クリーンアップを登録 |
| `testdata/` | テストフィクスチャ用ディレクトリ |
| `-short` | 長時間テストをスキップ |
| `-tags=integration` | ビルドタグでテストを実行 |

**覚えておいてください**: 良いテストは高速で、信頼性があり、保守可能で、明確です。複雑さより明確さを目指してください。
