---
name: golang-patterns
description: Idiomatic Go patterns, best practices, and conventions for building robust, efficient, and maintainable Go applications.
---

# Go 開發模式

用於建構穩健、高效且可維護應用程式的慣用 Go 模式和最佳實務。

## 何時啟用

- 撰寫新的 Go 程式碼
- 審查 Go 程式碼
- 重構現有 Go 程式碼
- 設計 Go 套件/模組

## 核心原則

### 1. 簡單與清晰

Go 偏好簡單而非聰明。程式碼應該明顯且易讀。

```go
// 良好：清晰直接
func GetUser(id string) (*User, error) {
    user, err := db.FindUser(id)
    if err != nil {
        return nil, fmt.Errorf("get user %s: %w", id, err)
    }
    return user, nil
}

// 不良：過於聰明
func GetUser(id string) (*User, error) {
    return func() (*User, error) {
        if u, e := db.FindUser(id); e == nil {
            return u, nil
        } else {
            return nil, e
        }
    }()
}
```

### 2. 讓零值有用

設計類型使其零值無需初始化即可立即使用。

```go
// 良好：零值有用
type Counter struct {
    mu    sync.Mutex
    count int // 零值為 0，可直接使用
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.count++
    c.mu.Unlock()
}

// 良好：bytes.Buffer 零值可用
var buf bytes.Buffer
buf.WriteString("hello")

// 不良：需要初始化
type BadCounter struct {
    counts map[string]int // nil map 會 panic
}
```

### 3. 接受介面，回傳結構

函式應接受介面參數並回傳具體類型。

```go
// 良好：接受介面，回傳具體類型
func ProcessData(r io.Reader) (*Result, error) {
    data, err := io.ReadAll(r)
    if err != nil {
        return nil, err
    }
    return &Result{Data: data}, nil
}

// 不良：回傳介面（不必要地隱藏實作細節）
func ProcessData(r io.Reader) (io.Reader, error) {
    // ...
}
```

## 錯誤處理模式

### 帶上下文的錯誤包裝

```go
// 良好：包裝錯誤並加上上下文
func LoadConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("load config %s: %w", path, err)
    }

    var cfg Config
    if err := json.Unmarshal(data, &cfg); err != nil {
        return nil, fmt.Errorf("parse config %s: %w", path, err)
    }

    return &cfg, nil
}
```

### 自訂錯誤類型

```go
// 定義領域特定錯誤
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation failed on %s: %s", e.Field, e.Message)
}

// 常見情況的哨兵錯誤
var (
    ErrNotFound     = errors.New("resource not found")
    ErrUnauthorized = errors.New("unauthorized")
    ErrInvalidInput = errors.New("invalid input")
)
```

### 使用 errors.Is 和 errors.As 檢查錯誤

```go
func HandleError(err error) {
    // 檢查特定錯誤
    if errors.Is(err, sql.ErrNoRows) {
        log.Println("No records found")
        return
    }

    // 檢查錯誤類型
    var validationErr *ValidationError
    if errors.As(err, &validationErr) {
        log.Printf("Validation error on field %s: %s",
            validationErr.Field, validationErr.Message)
        return
    }

    // 未知錯誤
    log.Printf("Unexpected error: %v", err)
}
```

### 絕不忽略錯誤

```go
// 不良：用空白識別符忽略錯誤
result, _ := doSomething()

// 良好：處理或明確說明為何安全忽略
result, err := doSomething()
if err != nil {
    return err
}

// 可接受：當錯誤真的不重要時（罕見）
_ = writer.Close() // 盡力清理，錯誤在其他地方記錄
```

## 並行模式

### Worker Pool

```go
func WorkerPool(jobs <-chan Job, results chan<- Result, numWorkers int) {
    var wg sync.WaitGroup

    for i := 0; i < numWorkers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for job := range jobs {
                results <- process(job)
            }
        }()
    }

    wg.Wait()
    close(results)
}
```

### 取消和逾時的 Context

```go
func FetchWithTimeout(ctx context.Context, url string) ([]byte, error) {
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()

    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        return nil, fmt.Errorf("create request: %w", err)
    }

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return nil, fmt.Errorf("fetch %s: %w", url, err)
    }
    defer resp.Body.Close()

    return io.ReadAll(resp.Body)
}
```

### 優雅關閉

```go
func GracefulShutdown(server *http.Server) {
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

    <-quit
    log.Println("Shutting down server...")

    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    if err := server.Shutdown(ctx); err != nil {
        log.Fatalf("Server forced to shutdown: %v", err)
    }

    log.Println("Server exited")
}
```

### 協調 Goroutines 的 errgroup

```go
import "golang.org/x/sync/errgroup"

func FetchAll(ctx context.Context, urls []string) ([][]byte, error) {
    g, ctx := errgroup.WithContext(ctx)
    results := make([][]byte, len(urls))

    for i, url := range urls {
        i, url := i, url // 捕獲迴圈變數
        g.Go(func() error {
            data, err := FetchWithTimeout(ctx, url)
            if err != nil {
                return err
            }
            results[i] = data
            return nil
        })
    }

    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

### 避免 Goroutine 洩漏

```go
// 不良：如果 context 被取消會洩漏 goroutine
func leakyFetch(ctx context.Context, url string) <-chan []byte {
    ch := make(chan []byte)
    go func() {
        data, _ := fetch(url)
        ch <- data // 如果無接收者會永遠阻塞
    }()
    return ch
}

// 良好：正確處理取消
func safeFetch(ctx context.Context, url string) <-chan []byte {
    ch := make(chan []byte, 1) // 帶緩衝的 channel
    go func() {
        data, err := fetch(url)
        if err != nil {
            return
        }
        select {
        case ch <- data:
        case <-ctx.Done():
        }
    }()
    return ch
}
```

## 介面設計

### 小而專注的介面

```go
// 良好：單一方法介面
type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}

type Closer interface {
    Close() error
}

// 依需要組合介面
type ReadWriteCloser interface {
    Reader
    Writer
    Closer
}
```

### 在使用處定義介面

```go
// 在消費者套件中，而非提供者
package service

// UserStore 定義此服務需要的內容
type UserStore interface {
    GetUser(id string) (*User, error)
    SaveUser(user *User) error
}

type Service struct {
    store UserStore
}

// 具體實作可以在另一個套件
// 它不需要知道這個介面
```

### 使用型別斷言的可選行為

```go
type Flusher interface {
    Flush() error
}

func WriteAndFlush(w io.Writer, data []byte) error {
    if _, err := w.Write(data); err != nil {
        return err
    }

    // 如果支援則 Flush
    if f, ok := w.(Flusher); ok {
        return f.Flush()
    }
    return nil
}
```

## 套件組織

### 標準專案結構

```text
myproject/
├── cmd/
│   └── myapp/
│       └── main.go           # 進入點
├── internal/
│   ├── handler/              # HTTP handlers
│   ├── service/              # 業務邏輯
│   ├── repository/           # 資料存取
│   └── config/               # 設定
├── pkg/
│   └── client/               # 公開 API 客戶端
├── api/
│   └── v1/                   # API 定義（proto、OpenAPI）
├── testdata/                 # 測試 fixtures
├── go.mod
├── go.sum
└── Makefile
```

### 套件命名

```go
// 良好：簡短、小寫、無底線
package http
package json
package user

// 不良：冗長、混合大小寫或冗餘
package httpHandler
package json_parser
package userService // 冗餘的 'Service' 後綴
```

### 避免套件層級狀態

```go
// 不良：全域可變狀態
var db *sql.DB

func init() {
    db, _ = sql.Open("postgres", os.Getenv("DATABASE_URL"))
}

// 良好：依賴注入
type Server struct {
    db *sql.DB
}

func NewServer(db *sql.DB) *Server {
    return &Server{db: db}
}
```

## 結構設計

### Functional Options 模式

```go
type Server struct {
    addr    string
    timeout time.Duration
    logger  *log.Logger
}

type Option func(*Server)

func WithTimeout(d time.Duration) Option {
    return func(s *Server) {
        s.timeout = d
    }
}

func WithLogger(l *log.Logger) Option {
    return func(s *Server) {
        s.logger = l
    }
}

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{
        addr:    addr,
        timeout: 30 * time.Second, // 預設值
        logger:  log.Default(),    // 預設值
    }
    for _, opt := range opts {
        opt(s)
    }
    return s
}

// 使用方式
server := NewServer(":8080",
    WithTimeout(60*time.Second),
    WithLogger(customLogger),
)
```

### 嵌入用於組合

```go
type Logger struct {
    prefix string
}

func (l *Logger) Log(msg string) {
    fmt.Printf("[%s] %s\n", l.prefix, msg)
}

type Server struct {
    *Logger // 嵌入 - Server 獲得 Log 方法
    addr    string
}

func NewServer(addr string) *Server {
    return &Server{
        Logger: &Logger{prefix: "SERVER"},
        addr:   addr,
    }
}

// 使用方式
s := NewServer(":8080")
s.Log("Starting...") // 呼叫嵌入的 Logger.Log
```

## 記憶體與效能

### 已知大小時預分配 Slice

```go
// 不良：多次擴展 slice
func processItems(items []Item) []Result {
    var results []Result
    for _, item := range items {
        results = append(results, process(item))
    }
    return results
}

// 良好：單次分配
func processItems(items []Item) []Result {
    results := make([]Result, 0, len(items))
    for _, item := range items {
        results = append(results, process(item))
    }
    return results
}
```

### 頻繁分配使用 sync.Pool

```go
var bufferPool = sync.Pool{
    New: func() interface{} {
        return new(bytes.Buffer)
    },
}

func ProcessRequest(data []byte) []byte {
    buf := bufferPool.Get().(*bytes.Buffer)
    defer func() {
        buf.Reset()
        bufferPool.Put(buf)
    }()

    buf.Write(data)
    // 處理...
    return buf.Bytes()
}
```

### 避免迴圈中的字串串接

```go
// 不良：產生多次字串分配
func join(parts []string) string {
    var result string
    for _, p := range parts {
        result += p + ","
    }
    return result
}

// 良好：使用 strings.Builder 單次分配
func join(parts []string) string {
    var sb strings.Builder
    for i, p := range parts {
        if i > 0 {
            sb.WriteString(",")
        }
        sb.WriteString(p)
    }
    return sb.String()
}

// 最佳：使用標準函式庫
func join(parts []string) string {
    return strings.Join(parts, ",")
}
```

## Go 工具整合

### 基本指令

```bash
# 建置和執行
go build ./...
go run ./cmd/myapp

# 測試
go test ./...
go test -race ./...
go test -cover ./...

# 靜態分析
go vet ./...
staticcheck ./...
golangci-lint run

# 模組管理
go mod tidy
go mod verify

# 格式化
gofmt -w .
goimports -w .
```

### 建議的 Linter 設定（.golangci.yml）

```yaml
linters:
  enable:
    - errcheck
    - gosimple
    - govet
    - ineffassign
    - staticcheck
    - unused
    - gofmt
    - goimports
    - misspell
    - unconvert
    - unparam

linters-settings:
  errcheck:
    check-type-assertions: true
  govet:
    enable:
      - shadow

issues:
  exclude-use-default: false
```

## 快速參考：Go 慣用語

| 慣用語 | 描述 |
|-------|------|
| 接受介面，回傳結構 | 函式接受介面參數，回傳具體類型 |
| 錯誤是值 | 將錯誤視為一等值，而非例外 |
| 不要透過共享記憶體通訊 | 使用 channel 在 goroutine 間協調 |
| 讓零值有用 | 類型應無需明確初始化即可工作 |
| 一點複製比一點依賴好 | 避免不必要的外部依賴 |
| 清晰優於聰明 | 優先考慮可讀性而非聰明 |
| gofmt 不是任何人的最愛但是所有人的朋友 | 總是用 gofmt/goimports 格式化 |
| 提早返回 | 先處理錯誤，保持快樂路徑不縮排 |

## 要避免的反模式

```go
// 不良：長函式中的裸返回
func process() (result int, err error) {
    // ... 50 行 ...
    return // 返回什麼？
}

// 不良：使用 panic 作為控制流程
func GetUser(id string) *User {
    user, err := db.Find(id)
    if err != nil {
        panic(err) // 不要這樣做
    }
    return user
}

// 不良：在結構中傳遞 context
type Request struct {
    ctx context.Context // Context 應該是第一個參數
    ID  string
}

// 良好：Context 作為第一個參數
func ProcessRequest(ctx context.Context, id string) error {
    // ...
}

// 不良：混合值和指標接收器
type Counter struct{ n int }
func (c Counter) Value() int { return c.n }    // 值接收器
func (c *Counter) Increment() { c.n++ }        // 指標接收器
// 選擇一種風格並保持一致
```

**記住**：Go 程式碼應該以最好的方式無聊 - 可預測、一致且易於理解。有疑慮時，保持簡單。
