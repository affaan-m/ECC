---
name: golang-patterns
description: İdiomatic Go desenler, en iyi uygulamalar ve sağlam, verimli ve bakımı kolay Go uygulamaları oluşturmak için konvansiyonlar.
origin: ECC
---

# Go Geliştirme Desenleri

Sağlam, verimli ve bakımı kolay uygulamalar oluşturmak için idiomatic Go desenleri ve en iyi uygulamalar.

## Ne Zaman Etkinleştirmeli

- Yeni Go kodu yazarken
- Go kodunu gözden geçirirken
- Mevcut Go kodunu refactor ederken
- Go paketleri/modülleri tasarlarken

## Temel Prensipler

### 1. Basitlik ve Açıklık

Go, zekiceden ziyade basitliği tercih eder. Kod açık ve okunması kolay olmalıdır.

```go
// İyi: Açık ve doğrudan
func GetUser(id string) (*User, error) {
    user, err := db.FindUser(id)
    if err != nil {
        return nil, fmt.Errorf("get user %s: %w", id, err)
    }
    return user, nil
}

// Kötü: Aşırı zeki
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

### 2. Sıfır Değeri Kullanışlı Yapın

Türleri, sıfır değerinin başlatma olmadan hemen kullanılabilir olacağı şekilde tasarlayın.

```go
// İyi: Sıfır değer kullanışlıdır
type Counter struct {
    mu    sync.Mutex
    count int // sıfır değer 0'dır, kullanıma hazırdır
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.count++
    c.mu.Unlock()
}

// İyi: bytes.Buffer sıfır değerle çalışır
var buf bytes.Buffer
buf.WriteString("hello")

// Kötü: Başlatma gerektirir
type BadCounter struct {
    counts map[string]int // nil map panic verir
}
```

### 3. Interface Kabul Et, Struct Döndür

Fonksiyonlar interface parametreleri kabul etmeli ve somut tipler döndürmelidir.

```go
// İyi: Interface kabul eder, somut tip döndürür
func ProcessData(r io.Reader) (*Result, error) {
    data, err := io.ReadAll(r)
    if err != nil {
        return nil, err
    }
    return &Result{Data: data}, nil
}

// Kötü: Interface döndürür (implementasyon detaylarını gereksiz yere gizler)
func ProcessData(r io.Reader) (io.Reader, error) {
    // ...
}
```

## Hata İşleme Desenleri

### Bağlam ile Hata Sarmalama

```go
// İyi: Hataları bağlamla sarmalayın
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

### Özel Hata Tipleri

```go
// Domain'e özgü hataları tanımlayın
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation failed on %s: %s", e.Field, e.Message)
}

// Yaygın durumlar için sentinel hatalar
var (
    ErrNotFound     = errors.New("resource not found")
    ErrUnauthorized = errors.New("unauthorized")
    ErrInvalidInput = errors.New("invalid input")
)
```

### errors.Is ve errors.As ile Hata Kontrolü

```go
func HandleError(err error) {
    // Belirli bir hatayı kontrol et
    if errors.Is(err, sql.ErrNoRows) {
        log.Println("No records found")
        return
    }

    // Hata tipini kontrol et
    var validationErr *ValidationError
    if errors.As(err, &validationErr) {
        log.Printf("Validation error on field %s: %s",
            validationErr.Field, validationErr.Message)
        return
    }

    // Bilinmeyen hata
    log.Printf("Unexpected error: %v", err)
}
```

### Hataları Asla Göz Ardı Etmeyin

```go
// Kötü: Boş tanımlayıcı ile hatayı göz ardı etmek
result, _ := doSomething()

// İyi: Hatayı işleyin veya neden göz ardı edildiğini açıkça belgelendirin
result, err := doSomething()
if err != nil {
    return err
}

// Kabul edilebilir: Hata gerçekten önemli olmadığında (nadir)
_ = writer.Close() // En iyi çaba temizliği, hata başka yerde loglanır
```

## Eşzamanlılık Desenleri

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

### İptal ve Zaman Aşımları için Context

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

### Zarif Kapatma

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

### Koordineli Goroutine'ler için errgroup

```go
import "golang.org/x/sync/errgroup"

func FetchAll(ctx context.Context, urls []string) ([][]byte, error) {
    g, ctx := errgroup.WithContext(ctx)
    results := make([][]byte, len(urls))

    for i, url := range urls {
        i, url := i, url // Loop değişkenlerini yakala
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

### Goroutine Sızıntılarından Kaçınma

```go
// Kötü: Context iptal edilirse goroutine sızıntısı
func leakyFetch(ctx context.Context, url string) <-chan []byte {
    ch := make(chan []byte)
    go func() {
        data, _ := fetch(url)
        ch <- data // Alıcı yoksa sonsuza kadar bloklar
    }()
    return ch
}

// İyi: İptali düzgün bir şekilde işler
func safeFetch(ctx context.Context, url string) <-chan []byte {
    ch := make(chan []byte, 1) // Tamponlu kanal
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

## Interface Tasarımı

### Küçük, Odaklanmış Interface'ler

```go
// İyi: Tek metodlu interface'ler
type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}

type Closer interface {
    Close() error
}

// Interface'leri gerektiği gibi birleştirin
type ReadWriteCloser interface {
    Reader
    Writer
    Closer
}
```

### Interface'leri Kullanıldıkları Yerde Tanımlayın

```go
// Sağlayıcı pakette değil, tüketici pakette
package service

// UserStore bu servisin neye ihtiyacı olduğunu tanımlar
type UserStore interface {
    GetUser(id string) (*User, error)
    SaveUser(user *User) error
}

type Service struct {
    store UserStore
}

// Somut implementasyon başka bir pakette olabilir
// Bu interface'i bilmesine gerek yoktur
```

### Type Assertion ile Opsiyonel Davranış

```go
type Flusher interface {
    Flush() error
}

func WriteAndFlush(w io.Writer, data []byte) error {
    if _, err := w.Write(data); err != nil {
        return err
    }

    // Destekleniyorsa flush et
    if f, ok := w.(Flusher); ok {
        return f.Flush()
    }
    return nil
}
```

## Paket Organizasyonu

### Standart Proje Düzeni

```text
myproject/
├── cmd/
│   └── myapp/
│       └── main.go           # Giriş noktası
├── internal/
│   ├── handler/              # HTTP handler'lar
│   ├── service/              # İş mantığı
│   ├── repository/           # Veri erişimi
│   └── config/               # Yapılandırma
├── pkg/
│   └── client/               # Public API client
├── api/
│   └── v1/                   # API tanımları (proto, OpenAPI)
├── testdata/                 # Test fixture'ları
├── go.mod
├── go.sum
└── Makefile
```

### Paket İsimlendirme

```go
// İyi: Kısa, küçük harf, alt çizgi yok
package http
package json
package user

// Kötü: Verbose, karışık büyük/küçük harf veya gereksiz
package httpHandler
package json_parser
package userService // Gereksiz 'Service' eki
```

### Paket Seviyesi State'ten Kaçının

```go
// Kötü: Global değişken state
var db *sql.DB

func init() {
    db, _ = sql.Open("postgres", os.Getenv("DATABASE_URL"))
}

// İyi: Dependency injection
type Server struct {
    db *sql.DB
}

func NewServer(db *sql.DB) *Server {
    return &Server{db: db}
}
```

## Struct Tasarımı

### Functional Options Deseni

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
        timeout: 30 * time.Second, // varsayılan
        logger:  log.Default(),    // varsayılan
    }
    for _, opt := range opts {
        opt(s)
    }
    return s
}

// Kullanım
server := NewServer(":8080",
    WithTimeout(60*time.Second),
    WithLogger(customLogger),
)
```

### Kompozisyon için Embedding

```go
type Logger struct {
    prefix string
}

func (l *Logger) Log(msg string) {
    fmt.Printf("[%s] %s\n", l.prefix, msg)
}

type Server struct {
    *Logger // Embedding - Server Log metodunu alır
    addr    string
}

func NewServer(addr string) *Server {
    return &Server{
        Logger: &Logger{prefix: "SERVER"},
        addr:   addr,
    }
}

// Kullanım
s := NewServer(":8080")
s.Log("Starting...") // Gömülü Logger.Log'u çağırır
```

## Bellek ve Performans

### Boyut Bilindiğinde Slice'ları Önceden Tahsis Edin

```go
// Kötü: Slice'ı birden çok kez büyütür
func processItems(items []Item) []Result {
    var results []Result
    for _, item := range items {
        results = append(results, process(item))
    }
    return results
}

// İyi: Tek tahsis
func processItems(items []Item) []Result {
    results := make([]Result, 0, len(items))
    for _, item := range items {
        results = append(results, process(item))
    }
    return results
}
```

### Sık Tahsisler için sync.Pool Kullanın

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
    // İşle...
    return buf.Bytes()
}
```

### Döngülerde String Birleştirmekten Kaçının

```go
// Kötü: Birçok string tahsisi oluşturur
func join(parts []string) string {
    var result string
    for _, p := range parts {
        result += p + ","
    }
    return result
}

// İyi: strings.Builder ile tek tahsis
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

// En iyi: Standart kütüphaneyi kullanın
func join(parts []string) string {
    return strings.Join(parts, ",")
}
```

## Go Tooling Entegrasyonu

### Temel Komutlar

```bash
# Build ve çalıştır
go build ./...
go run ./cmd/myapp

# Test
go test ./...
go test -race ./...
go test -cover ./...

# Statik analiz
go vet ./...
staticcheck ./...
golangci-lint run

# Modül yönetimi
go mod tidy
go mod verify

# Formatlama
gofmt -w .
goimports -w .
```

### Önerilen Linter Yapılandırması (.golangci.yml)

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

## Hızlı Referans: Go İfadeleri

| İfade | Açıklama |
|-------|----------|
| Interface kabul et, struct döndür | Fonksiyonlar interface parametreleri kabul eder, somut tipler döndürür |
| Hatalar değerdir | Hataları exception değil birinci sınıf değerler olarak ele alın |
| Belleği paylaşarak iletişim kurmayın | Goroutine'ler arası koordinasyon için kanalları kullanın |
| Sıfır değeri kullanışlı yapın | Tipler açık başlatma olmadan çalışmalıdır |
| Biraz kopyalama biraz bağımlılıktan iyidir | Gereksiz dış bağımlılıklardan kaçının |
| Açık zekiden iyidir | Okunabilirliği zekiceden öncelikli kılın |
| gofmt kimsenin favorisi değil ama herkesin arkadaşı | Her zaman gofmt/goimports ile formatlayın |
| Erken dönün | Hataları önce işleyin, mutlu yolu girintilendirilmemiş tutun |

## Kaçınılması Gereken Anti-Desenler

```go
// Kötü: Uzun fonksiyonlarda naked return'ler
func process() (result int, err error) {
    // ... 50 satır ...
    return // Ne döndürülüyor?
}

// Kötü: Kontrol akışı için panic kullanmak
func GetUser(id string) *User {
    user, err := db.Find(id)
    if err != nil {
        panic(err) // Bunu yapmayın
    }
    return user
}

// Kötü: Struct içinde context geçmek
type Request struct {
    ctx context.Context // Context ilk parametre olmalı
    ID  string
}

// İyi: Context ilk parametre olarak
func ProcessRequest(ctx context.Context, id string) error {
    // ...
}

// Kötü: Value ve pointer receiver'ları karıştırmak
type Counter struct{ n int }
func (c Counter) Value() int { return c.n }    // Value receiver
func (c *Counter) Increment() { c.n++ }        // Pointer receiver
// Bir stil seçin ve tutarlı olun
```

**Unutmayın**: Go kodu en iyi anlamda sıkıcı olmalıdır - öngörülebilir, tutarlı ve anlaşılması kolay. Şüphe duyduğunuzda, basit tutun.
