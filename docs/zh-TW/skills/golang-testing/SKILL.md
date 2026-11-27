---
name: golang-testing
description: Go testing patterns including table-driven tests, subtests, benchmarks, fuzzing, and test coverage. Follows TDD methodology with idiomatic Go practices.
---

# Go 測試模式

用於撰寫可靠、可維護測試的完整 Go 測試模式，遵循 TDD 方法論。

## 何時啟用

- 撰寫新的 Go 函式或方法
- 為現有程式碼增加測試覆蓋率
- 為效能關鍵程式碼建立基準測試
- 實作輸入驗證的模糊測試
- 在 Go 專案中遵循 TDD 工作流程

## Go 的 TDD 工作流程

### RED-GREEN-REFACTOR 循環

```
RED     → 先寫失敗的測試
GREEN   → 撰寫最少程式碼使測試通過
REFACTOR → 在保持測試綠色的同時改善程式碼
REPEAT  → 繼續下一個需求
```

### Go 中的逐步 TDD

```go
// 步驟 1：定義介面/簽章
// calculator.go
package calculator

func Add(a, b int) int {
    panic("not implemented") // 佔位符
}

// 步驟 2：撰寫失敗測試（RED）
// calculator_test.go
package calculator

import "testing"

func TestAdd(t *testing.T) {
    got := Add(2, 3)
    want := 5
    if got != want {
        t.Errorf("Add(2, 3) = %d; want %d", got, want)
    }
}

// 步驟 3：執行測試 - 驗證失敗
// $ go test
// --- FAIL: TestAdd (0.00s)
// panic: not implemented

// 步驟 4：實作最少程式碼（GREEN）
func Add(a, b int) int {
    return a + b
}

// 步驟 5：執行測試 - 驗證通過
// $ go test
// PASS

// 步驟 6：如需要則重構，驗證測試仍然通過
```

## 表格驅動測試

Go 測試的標準模式。以最少程式碼達到完整覆蓋。

```go
func TestAdd(t *testing.T) {
    tests := []struct {
        name     string
        a, b     int
        expected int
    }{
        {"positive numbers", 2, 3, 5},
        {"negative numbers", -1, -2, -3},
        {"zero values", 0, 0, 0},
        {"mixed signs", -1, 1, 0},
        {"large numbers", 1000000, 2000000, 3000000},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := Add(tt.a, tt.b)
            if got != tt.expected {
                t.Errorf("Add(%d, %d) = %d; want %d",
                    tt.a, tt.b, got, tt.expected)
            }
        })
    }
}
```

### 帶錯誤案例的表格驅動測試

```go
func TestParseConfig(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        want    *Config
        wantErr bool
    }{
        {
            name:  "valid config",
            input: `{"host": "localhost", "port": 8080}`,
            want:  &Config{Host: "localhost", Port: 8080},
        },
        {
            name:    "invalid JSON",
            input:   `{invalid}`,
            wantErr: true,
        },
        {
            name:    "empty input",
            input:   "",
            wantErr: true,
        },
        {
            name:  "minimal config",
            input: `{}`,
            want:  &Config{}, // 零值 config
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := ParseConfig(tt.input)

            if tt.wantErr {
                if err == nil {
                    t.Error("expected error, got nil")
                }
                return
            }

            if err != nil {
                t.Fatalf("unexpected error: %v", err)
            }

            if !reflect.DeepEqual(got, tt.want) {
                t.Errorf("got %+v; want %+v", got, tt.want)
            }
        })
    }
}
```

## 子測試

### 組織相關測試

```go
func TestUser(t *testing.T) {
    // 所有子測試共享的設置
    db := setupTestDB(t)

    t.Run("Create", func(t *testing.T) {
        user := &User{Name: "Alice"}
        err := db.CreateUser(user)
        if err != nil {
            t.Fatalf("CreateUser failed: %v", err)
        }
        if user.ID == "" {
            t.Error("expected user ID to be set")
        }
    })

    t.Run("Get", func(t *testing.T) {
        user, err := db.GetUser("alice-id")
        if err != nil {
            t.Fatalf("GetUser failed: %v", err)
        }
        if user.Name != "Alice" {
            t.Errorf("got name %q; want %q", user.Name, "Alice")
        }
    })

    t.Run("Update", func(t *testing.T) {
        // ...
    })

    t.Run("Delete", func(t *testing.T) {
        // ...
    })
}
```

### 並行子測試

```go
func TestParallel(t *testing.T) {
    tests := []struct {
        name  string
        input string
    }{
        {"case1", "input1"},
        {"case2", "input2"},
        {"case3", "input3"},
    }

    for _, tt := range tests {
        tt := tt // 捕獲範圍變數
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel() // 並行執行子測試
            result := Process(tt.input)
            // 斷言...
            _ = result
        })
    }
}
```

## 測試輔助函式

### 輔助函式

```go
func setupTestDB(t *testing.T) *sql.DB {
    t.Helper() // 標記為輔助函式

    db, err := sql.Open("sqlite3", ":memory:")
    if err != nil {
        t.Fatalf("failed to open database: %v", err)
    }

    // 測試結束時清理
    t.Cleanup(func() {
        db.Close()
    })

    // 執行 migrations
    if _, err := db.Exec(schema); err != nil {
        t.Fatalf("failed to create schema: %v", err)
    }

    return db
}

func assertNoError(t *testing.T, err error) {
    t.Helper()
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
}

func assertEqual[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want {
        t.Errorf("got %v; want %v", got, want)
    }
}
```

### 臨時檔案和目錄

```go
func TestFileProcessing(t *testing.T) {
    // 建立臨時目錄 - 自動清理
    tmpDir := t.TempDir()

    // 建立測試檔案
    testFile := filepath.Join(tmpDir, "test.txt")
    err := os.WriteFile(testFile, []byte("test content"), 0644)
    if err != nil {
        t.Fatalf("failed to create test file: %v", err)
    }

    // 執行測試
    result, err := ProcessFile(testFile)
    if err != nil {
        t.Fatalf("ProcessFile failed: %v", err)
    }

    // 斷言...
    _ = result
}
```

## Golden 檔案

使用儲存在 `testdata/` 中的預期輸出檔案進行測試。

```go
var update = flag.Bool("update", false, "update golden files")

func TestRender(t *testing.T) {
    tests := []struct {
        name  string
        input Template
    }{
        {"simple", Template{Name: "test"}},
        {"complex", Template{Name: "test", Items: []string{"a", "b"}}},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := Render(tt.input)

            golden := filepath.Join("testdata", tt.name+".golden")

            if *update {
                // 更新 golden 檔案：go test -update
                err := os.WriteFile(golden, got, 0644)
                if err != nil {
                    t.Fatalf("failed to update golden file: %v", err)
                }
            }

            want, err := os.ReadFile(golden)
            if err != nil {
                t.Fatalf("failed to read golden file: %v", err)
            }

            if !bytes.Equal(got, want) {
                t.Errorf("output mismatch:\ngot:\n%s\nwant:\n%s", got, want)
            }
        })
    }
}
```

## 使用介面 Mock

### 基於介面的 Mock

```go
// 定義依賴的介面
type UserRepository interface {
    GetUser(id string) (*User, error)
    SaveUser(user *User) error
}

// 生產實作
type PostgresUserRepository struct {
    db *sql.DB
}

func (r *PostgresUserRepository) GetUser(id string) (*User, error) {
    // 實際資料庫查詢
}

// 測試用 Mock 實作
type MockUserRepository struct {
    GetUserFunc  func(id string) (*User, error)
    SaveUserFunc func(user *User) error
}

func (m *MockUserRepository) GetUser(id string) (*User, error) {
    return m.GetUserFunc(id)
}

func (m *MockUserRepository) SaveUser(user *User) error {
    return m.SaveUserFunc(user)
}

// 使用 mock 的測試
func TestUserService(t *testing.T) {
    mock := &MockUserRepository{
        GetUserFunc: func(id string) (*User, error) {
            if id == "123" {
                return &User{ID: "123", Name: "Alice"}, nil
            }
            return nil, ErrNotFound
        },
    }

    service := NewUserService(mock)

    user, err := service.GetUserProfile("123")
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    if user.Name != "Alice" {
        t.Errorf("got name %q; want %q", user.Name, "Alice")
    }
}
```

## 基準測試

### 基本基準測試

```go
func BenchmarkProcess(b *testing.B) {
    data := generateTestData(1000)
    b.ResetTimer() // 不計算設置時間

    for i := 0; i < b.N; i++ {
        Process(data)
    }
}

// 執行：go test -bench=BenchmarkProcess -benchmem
// 輸出：BenchmarkProcess-8   10000   105234 ns/op   4096 B/op   10 allocs/op
```

### 不同大小的基準測試

```go
func BenchmarkSort(b *testing.B) {
    sizes := []int{100, 1000, 10000, 100000}

    for _, size := range sizes {
        b.Run(fmt.Sprintf("size=%d", size), func(b *testing.B) {
            data := generateRandomSlice(size)
            b.ResetTimer()

            for i := 0; i < b.N; i++ {
                // 複製以避免排序已排序的資料
                tmp := make([]int, len(data))
                copy(tmp, data)
                sort.Ints(tmp)
            }
        })
    }
}
```

### 記憶體分配基準測試

```go
func BenchmarkStringConcat(b *testing.B) {
    parts := []string{"hello", "world", "foo", "bar", "baz"}

    b.Run("plus", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            var s string
            for _, p := range parts {
                s += p
            }
            _ = s
        }
    })

    b.Run("builder", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            var sb strings.Builder
            for _, p := range parts {
                sb.WriteString(p)
            }
            _ = sb.String()
        }
    })

    b.Run("join", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            _ = strings.Join(parts, "")
        }
    })
}
```

## 模糊測試（Go 1.18+）

### 基本模糊測試

```go
func FuzzParseJSON(f *testing.F) {
    // 新增種子語料庫
    f.Add(`{"name": "test"}`)
    f.Add(`{"count": 123}`)
    f.Add(`[]`)
    f.Add(`""`)

    f.Fuzz(func(t *testing.T, input string) {
        var result map[string]interface{}
        err := json.Unmarshal([]byte(input), &result)

        if err != nil {
            // 隨機輸入預期會有無效 JSON
            return
        }

        // 如果解析成功，重新編碼應該可行
        _, err = json.Marshal(result)
        if err != nil {
            t.Errorf("Marshal failed after successful Unmarshal: %v", err)
        }
    })
}

// 執行：go test -fuzz=FuzzParseJSON -fuzztime=30s
```

### 多輸入模糊測試

```go
func FuzzCompare(f *testing.F) {
    f.Add("hello", "world")
    f.Add("", "")
    f.Add("abc", "abc")

    f.Fuzz(func(t *testing.T, a, b string) {
        result := Compare(a, b)

        // 屬性：Compare(a, a) 應該總是等於 0
        if a == b && result != 0 {
            t.Errorf("Compare(%q, %q) = %d; want 0", a, b, result)
        }

        // 屬性：Compare(a, b) 和 Compare(b, a) 應該有相反符號
        reverse := Compare(b, a)
        if (result > 0 && reverse >= 0) || (result < 0 && reverse <= 0) {
            if result != 0 || reverse != 0 {
                t.Errorf("Compare(%q, %q) = %d, Compare(%q, %q) = %d; inconsistent",
                    a, b, result, b, a, reverse)
            }
        }
    })
}
```

## 測試覆蓋率

### 執行覆蓋率

```bash
# 基本覆蓋率
go test -cover ./...

# 產生覆蓋率 profile
go test -coverprofile=coverage.out ./...

# 在瀏覽器查看覆蓋率
go tool cover -html=coverage.out

# 按函式查看覆蓋率
go tool cover -func=coverage.out

# 含競態偵測的覆蓋率
go test -race -coverprofile=coverage.out ./...
```

### 覆蓋率目標

| 程式碼類型 | 目標 |
|-----------|------|
| 關鍵業務邏輯 | 100% |
| 公開 API | 90%+ |
| 一般程式碼 | 80%+ |
| 產生的程式碼 | 排除 |

## HTTP Handler 測試

```go
func TestHealthHandler(t *testing.T) {
    // 建立請求
    req := httptest.NewRequest(http.MethodGet, "/health", nil)
    w := httptest.NewRecorder()

    // 呼叫 handler
    HealthHandler(w, req)

    // 檢查回應
    resp := w.Result()
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        t.Errorf("got status %d; want %d", resp.StatusCode, http.StatusOK)
    }

    body, _ := io.ReadAll(resp.Body)
    if string(body) != "OK" {
        t.Errorf("got body %q; want %q", body, "OK")
    }
}

func TestAPIHandler(t *testing.T) {
    tests := []struct {
        name       string
        method     string
        path       string
        body       string
        wantStatus int
        wantBody   string
    }{
        {
            name:       "get user",
            method:     http.MethodGet,
            path:       "/users/123",
            wantStatus: http.StatusOK,
            wantBody:   `{"id":"123","name":"Alice"}`,
        },
        {
            name:       "not found",
            method:     http.MethodGet,
            path:       "/users/999",
            wantStatus: http.StatusNotFound,
        },
        {
            name:       "create user",
            method:     http.MethodPost,
            path:       "/users",
            body:       `{"name":"Bob"}`,
            wantStatus: http.StatusCreated,
        },
    }

    handler := NewAPIHandler()

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            var body io.Reader
            if tt.body != "" {
                body = strings.NewReader(tt.body)
            }

            req := httptest.NewRequest(tt.method, tt.path, body)
            req.Header.Set("Content-Type", "application/json")
            w := httptest.NewRecorder()

            handler.ServeHTTP(w, req)

            if w.Code != tt.wantStatus {
                t.Errorf("got status %d; want %d", w.Code, tt.wantStatus)
            }

            if tt.wantBody != "" && w.Body.String() != tt.wantBody {
                t.Errorf("got body %q; want %q", w.Body.String(), tt.wantBody)
            }
        })
    }
}
```

## 測試指令

```bash
# 執行所有測試
go test ./...

# 執行詳細輸出的測試
go test -v ./...

# 執行特定測試
go test -run TestAdd ./...

# 執行匹配模式的測試
go test -run "TestUser/Create" ./...

# 執行帶競態偵測器的測試
go test -race ./...

# 執行帶覆蓋率的測試
go test -cover -coverprofile=coverage.out ./...

# 只執行短測試
go test -short ./...

# 執行帶逾時的測試
go test -timeout 30s ./...

# 執行基準測試
go test -bench=. -benchmem ./...

# 執行模糊測試
go test -fuzz=FuzzParse -fuzztime=30s ./...

# 計算測試執行次數（用於偵測不穩定測試）
go test -count=10 ./...
```

## 最佳實務

**應該做的：**
- 先寫測試（TDD）
- 使用表格驅動測試以獲得完整覆蓋
- 測試行為，而非實作
- 在輔助函式中使用 `t.Helper()`
- 對獨立測試使用 `t.Parallel()`
- 用 `t.Cleanup()` 清理資源
- 使用描述情境的有意義測試名稱

**不應該做的：**
- 不要直接測試私有函式（透過公開 API 測試）
- 不要在測試中使用 `time.Sleep()`（使用 channels 或條件）
- 不要忽略不穩定測試（修復或移除它們）
- 不要 mock 所有東西（可能時偏好整合測試）
- 不要跳過錯誤路徑測試

## CI/CD 整合

```yaml
# GitHub Actions 範例
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-go@v5
      with:
        go-version: '1.22'

    - name: Run tests
      run: go test -race -coverprofile=coverage.out ./...

    - name: Check coverage
      run: |
        go tool cover -func=coverage.out | grep total | awk '{print $3}' | \
        awk -F'%' '{if ($1 < 80) exit 1}'
```

**記住**：測試是文件。它們展示你的程式碼應該如何使用。清楚地撰寫並保持更新。
