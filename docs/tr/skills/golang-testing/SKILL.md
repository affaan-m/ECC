---
name: golang-testing
description: Table-driven testler, subtestler, benchmark'lar, fuzzing ve test coverage içeren Go test desenleri. TDD metodolojisi ile idiomatic Go uygulamalarını takip eder.
origin: ECC
---

# Go Test Desenleri

TDD metodolojisini takip eden güvenilir, bakımı kolay testler yazmak için kapsamlı Go test desenleri.

## Ne Zaman Etkinleştirmeli

- Yeni Go fonksiyonları veya metodları yazarken
- Mevcut koda test coverage eklerken
- Performans-kritik kod için benchmark'lar oluştururken
- Input validation için fuzz testler implement ederken
- Go projelerinde TDD workflow'u takip ederken

## Go için TDD Workflow'u

### RED-GREEN-REFACTOR Döngüsü

```
RED     → Önce başarısız bir test yaz
GREEN   → Testi geçirmek için minimal kod yaz
REFACTOR → Testleri yeşil tutarken kodu iyileştir
REPEAT  → Sonraki gereksinimle devam et
```

### Go'da Adım Adım TDD

```go
// Adım 1: Interface/signature'ı tanımla
// calculator.go
package calculator

func Add(a, b int) int {
    panic("not implemented") // Placeholder
}

// Adım 2: Başarısız test yaz (RED)
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

// Adım 3: Testi çalıştır - FAIL'i doğrula
// $ go test
// --- FAIL: TestAdd (0.00s)
// panic: not implemented

// Adım 4: Minimal kodu implement et (GREEN)
func Add(a, b int) int {
    return a + b
}

// Adım 5: Testi çalıştır - PASS'i doğrula
// $ go test
// PASS

// Adım 6: Gerekirse refactor et, testlerin hala geçtiğini doğrula
```

## Table-Driven Testler

Go testleri için standart desen. Minimal kodla kapsamlı coverage sağlar.

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

### Hata Durumları ile Table-Driven Testler

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
            want:  &Config{}, // Sıfır değer config
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

## Subtestler ve Sub-benchmark'lar

### İlgili Testleri Organize Etme

```go
func TestUser(t *testing.T) {
    // Tüm subtestler tarafından paylaşılan setup
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

### Paralel Subtestler

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
        tt := tt // Range değişkenini yakala
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel() // Subtestleri paralel çalıştır
            result := Process(tt.input)
            // assertion'lar...
            _ = result
        })
    }
}
```

## Test Helper'ları

### Helper Fonksiyonlar

```go
func setupTestDB(t *testing.T) *sql.DB {
    t.Helper() // Bunu helper fonksiyon olarak işaretle

    db, err := sql.Open("sqlite3", ":memory:")
    if err != nil {
        t.Fatalf("failed to open database: %v", err)
    }

    // Test bittiğinde temizlik
    t.Cleanup(func() {
        db.Close()
    })

    // Migration'ları çalıştır
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

### Geçici Dosyalar ve Dizinler

```go
func TestFileProcessing(t *testing.T) {
    // Geçici dizin oluştur - otomatik olarak temizlenir
    tmpDir := t.TempDir()

    // Test dosyası oluştur
    testFile := filepath.Join(tmpDir, "test.txt")
    err := os.WriteFile(testFile, []byte("test content"), 0644)
    if err != nil {
        t.Fatalf("failed to create test file: %v", err)
    }

    // Testi çalıştır
    result, err := ProcessFile(testFile)
    if err != nil {
        t.Fatalf("ProcessFile failed: %v", err)
    }

    // Assert...
    _ = result
}
```

## Golden File'lar

`testdata/` içinde saklanan beklenen çıktı dosyalarına karşı test etme.

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
                // Golden dosyayı güncelle: go test -update
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

## Interface'ler ile Mocking

### Interface Tabanlı Mocking

```go
// Bağımlılıklar için interface tanımlayın
type UserRepository interface {
    GetUser(id string) (*User, error)
    SaveUser(user *User) error
}

// Production implementasyonu
type PostgresUserRepository struct {
    db *sql.DB
}

func (r *PostgresUserRepository) GetUser(id string) (*User, error) {
    // Gerçek veritabanı sorgusu
}

// Testler için mock implementasyon
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

// Mock kullanarak test
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

## Benchmark'lar

### Temel Benchmark'lar

```go
func BenchmarkProcess(b *testing.B) {
    data := generateTestData(1000)
    b.ResetTimer() // Setup süresini sayma

    for i := 0; i < b.N; i++ {
        Process(data)
    }
}

// Çalıştır: go test -bench=BenchmarkProcess -benchmem
// Çıktı: BenchmarkProcess-8   10000   105234 ns/op   4096 B/op   10 allocs/op
```

### Farklı Boyutlarla Benchmark

```go
func BenchmarkSort(b *testing.B) {
    sizes := []int{100, 1000, 10000, 100000}

    for _, size := range sizes {
        b.Run(fmt.Sprintf("size=%d", size), func(b *testing.B) {
            data := generateRandomSlice(size)
            b.ResetTimer()

            for i := 0; i < b.N; i++ {
                // Zaten sıralanmış veriyi sıralamaktan kaçınmak için kopya oluştur
                tmp := make([]int, len(data))
                copy(tmp, data)
                sort.Ints(tmp)
            }
        })
    }
}
```

### Bellek Tahsis Benchmark'ları

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

## Fuzzing (Go 1.18+)

### Temel Fuzz Testi

```go
func FuzzParseJSON(f *testing.F) {
    // Seed corpus ekle
    f.Add(`{"name": "test"}`)
    f.Add(`{"count": 123}`)
    f.Add(`[]`)
    f.Add(`""`)

    f.Fuzz(func(t *testing.T, input string) {
        var result map[string]interface{}
        err := json.Unmarshal([]byte(input), &result)

        if err != nil {
            // Rastgele input için geçersiz JSON beklenebilir
            return
        }

        // Parsing başarılıysa, yeniden encoding çalışmalı
        _, err = json.Marshal(result)
        if err != nil {
            t.Errorf("Marshal failed after successful Unmarshal: %v", err)
        }
    })
}

// Çalıştır: go test -fuzz=FuzzParseJSON -fuzztime=30s
```

### Birden Çok Input ile Fuzz Testi

```go
func FuzzCompare(f *testing.F) {
    f.Add("hello", "world")
    f.Add("", "")
    f.Add("abc", "abc")

    f.Fuzz(func(t *testing.T, a, b string) {
        result := Compare(a, b)

        // Özellik: Compare(a, a) her zaman 0'a eşit olmalı
        if a == b && result != 0 {
            t.Errorf("Compare(%q, %q) = %d; want 0", a, b, result)
        }

        // Özellik: Compare(a, b) ve Compare(b, a) zıt işarete sahip olmalı
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

## Test Coverage

### Coverage Çalıştırma

```bash
# Temel coverage
go test -cover ./...

# Coverage profili oluştur
go test -coverprofile=coverage.out ./...

# Coverage'ı tarayıcıda görüntüle
go tool cover -html=coverage.out

# Fonksiyona göre coverage görüntüle
go tool cover -func=coverage.out

# Race detection ile coverage
go test -race -coverprofile=coverage.out ./...
```

### Coverage Hedefleri

| Kod Tipi | Hedef |
|----------|-------|
| Kritik iş mantığı | 100% |
| Public API'ler | 90%+ |
| Genel kod | 80%+ |
| Oluşturulan kod | Hariç tut |

### Oluşturulan Kodu Coverage'dan Hariç Tutma

```go
//go:generate mockgen -source=interface.go -destination=mock_interface.go

// Coverage profile'ında, build tag'leri ile hariç tut:
// go test -cover -tags=!generate ./...
```

## HTTP Handler Testleri

```go
func TestHealthHandler(t *testing.T) {
    // Request oluştur
    req := httptest.NewRequest(http.MethodGet, "/health", nil)
    w := httptest.NewRecorder()

    // Handler'ı çağır
    HealthHandler(w, req)

    // Response'u kontrol et
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

## Test Komutları

```bash
# Tüm testleri çalıştır
go test ./...

# Verbose çıktı ile testleri çalıştır
go test -v ./...

# Belirli bir testi çalıştır
go test -run TestAdd ./...

# Pattern ile eşleşen testleri çalıştır
go test -run "TestUser/Create" ./...

# Race detector ile testleri çalıştır
go test -race ./...

# Coverage ile testleri çalıştır
go test -cover -coverprofile=coverage.out ./...

# Sadece kısa testleri çalıştır
go test -short ./...

# Timeout ile testleri çalıştır
go test -timeout 30s ./...

# Benchmark'ları çalıştır
go test -bench=. -benchmem ./...

# Fuzzing çalıştır
go test -fuzz=FuzzParse -fuzztime=30s ./...

# Test çalışma sayısı (flaky test tespiti için)
go test -count=10 ./...
```

## En İyi Uygulamalar

**YAPIN:**
- Testleri ÖNCE yazın (TDD)
- Kapsamlı coverage için table-driven testler kullanın
- İmplementasyon değil davranış test edin
- Helper fonksiyonlarda `t.Helper()` kullanın
- Bağımsız testler için `t.Parallel()` kullanın
- Kaynakları `t.Cleanup()` ile temizleyin
- Senaryoyu açıklayan anlamlı test isimleri kullanın

**YAPMAYIN:**
- Private fonksiyonları doğrudan test etmeyin (public API üzerinden test edin)
- Testlerde `time.Sleep()` kullanmayın (channel'lar veya condition'lar kullanın)
- Flaky testleri göz ardı etmeyin (düzeltin veya kaldırın)
- Her şeyi mocklamayın (mümkün olduğunda integration testlerini tercih edin)
- Hata yolu testini atlamayın

## CI/CD ile Entegrasyon

```yaml
# GitHub Actions örneği
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

**Unutmayın**: Testler dokümantasyondur. Kodunuzun nasıl kullanılması gerektiğini gösterirler. Testleri açık yazın ve güncel tutun.
