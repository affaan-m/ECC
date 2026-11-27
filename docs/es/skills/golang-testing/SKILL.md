---
name: golang-testing
description: Patrones de pruebas Go incluyendo pruebas basadas en tablas, subpruebas, benchmarks, fuzzing y cobertura de código. Sigue la metodología TDD con prácticas idiomáticas de Go.
origin: ECC
---

# Patrones de Pruebas Go

Patrones completos de pruebas Go para escribir pruebas confiables y mantenibles siguiendo la metodología TDD.

## Cuándo Activar

- Escribir nuevas funciones o métodos Go
- Agregar cobertura de pruebas a código existente
- Crear benchmarks para código crítico en rendimiento
- Implementar pruebas fuzz para validación de entradas
- Seguir el flujo de trabajo TDD en proyectos Go

## Flujo de Trabajo TDD para Go

### El Ciclo RED-GREEN-REFACTOR

```
RED     → Escribir una prueba que falle primero
GREEN   → Escribir el código mínimo para pasar la prueba
REFACTOR → Mejorar el código manteniendo las pruebas en verde
REPEAT  → Continuar con el siguiente requisito
```

### TDD Paso a Paso en Go

```go
// Paso 1: Definir la interfaz/firma
// calculator.go
package calculator

func Add(a, b int) int {
    panic("not implemented") // Marcador de posición
}

// Paso 2: Escribir prueba que falle (RED)
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

// Paso 3: Ejecutar prueba - verificar FALLO
// $ go test
// --- FAIL: TestAdd (0.00s)
// panic: not implemented

// Paso 4: Implementar código mínimo (GREEN)
func Add(a, b int) int {
    return a + b
}

// Paso 5: Ejecutar prueba - verificar PASA
// $ go test
// PASS

// Paso 6: Refactorizar si es necesario, verificar que las pruebas sigan pasando
```

## Pruebas Basadas en Tablas

El patrón estándar para pruebas Go. Permite cobertura comprensiva con código mínimo.

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

### Pruebas Basadas en Tablas con Casos de Error

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
            want:  &Config{}, // Valor cero de Config
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

## Subpruebas y Sub-benchmarks

### Organizar Pruebas Relacionadas

```go
func TestUser(t *testing.T) {
    // Configuración compartida por todas las subpruebas
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

### Subpruebas en Paralelo

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
        tt := tt // Capturar variable del rango
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel() // Ejecutar subpruebas en paralelo
            result := Process(tt.input)
            // aserciones...
            _ = result
        })
    }
}
```

## Helpers de Prueba

### Funciones Helper

```go
func setupTestDB(t *testing.T) *sql.DB {
    t.Helper() // Marca esta como función helper

    db, err := sql.Open("sqlite3", ":memory:")
    if err != nil {
        t.Fatalf("failed to open database: %v", err)
    }

    // Limpieza cuando la prueba termina
    t.Cleanup(func() {
        db.Close()
    })

    // Ejecutar migraciones
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

### Archivos y Directorios Temporales

```go
func TestFileProcessing(t *testing.T) {
    // Crear directorio temporal - se limpia automáticamente
    tmpDir := t.TempDir()

    // Crear archivo de prueba
    testFile := filepath.Join(tmpDir, "test.txt")
    err := os.WriteFile(testFile, []byte("test content"), 0644)
    if err != nil {
        t.Fatalf("failed to create test file: %v", err)
    }

    // Ejecutar prueba
    result, err := ProcessFile(testFile)
    if err != nil {
        t.Fatalf("ProcessFile failed: %v", err)
    }

    // Aserciones...
    _ = result
}
```

## Golden Files

Probar contra archivos de salida esperada almacenados en `testdata/`.

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
                // Actualizar golden file: go test -update
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

## Mocking con Interfaces

### Mocking Basado en Interfaces

```go
// Definir interfaz para dependencias
type UserRepository interface {
    GetUser(id string) (*User, error)
    SaveUser(user *User) error
}

// Implementación de producción
type PostgresUserRepository struct {
    db *sql.DB
}

func (r *PostgresUserRepository) GetUser(id string) (*User, error) {
    // Consulta real a base de datos
}

// Implementación mock para pruebas
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

// Prueba usando mock
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

## Benchmarks

### Benchmarks Básicos

```go
func BenchmarkProcess(b *testing.B) {
    data := generateTestData(1000)
    b.ResetTimer() // No contar el tiempo de configuración

    for i := 0; i < b.N; i++ {
        Process(data)
    }
}

// Ejecutar: go test -bench=BenchmarkProcess -benchmem
// Salida: BenchmarkProcess-8   10000   105234 ns/op   4096 B/op   10 allocs/op
```

### Benchmark con Diferentes Tamaños

```go
func BenchmarkSort(b *testing.B) {
    sizes := []int{100, 1000, 10000, 100000}

    for _, size := range sizes {
        b.Run(fmt.Sprintf("size=%d", size), func(b *testing.B) {
            data := generateRandomSlice(size)
            b.ResetTimer()

            for i := 0; i < b.N; i++ {
                // Hacer una copia para evitar ordenar datos ya ordenados
                tmp := make([]int, len(data))
                copy(tmp, data)
                sort.Ints(tmp)
            }
        })
    }
}
```

### Benchmarks de Asignación de Memoria

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

### Prueba Fuzz Básica

```go
func FuzzParseJSON(f *testing.F) {
    // Agregar corpus semilla
    f.Add(`{"name": "test"}`)
    f.Add(`{"count": 123}`)
    f.Add(`[]`)
    f.Add(`""`)

    f.Fuzz(func(t *testing.T, input string) {
        var result map[string]interface{}
        err := json.Unmarshal([]byte(input), &result)

        if err != nil {
            // JSON inválido es esperado para entrada aleatoria
            return
        }

        // Si el parseo tuvo éxito, la re-codificación debería funcionar
        _, err = json.Marshal(result)
        if err != nil {
            t.Errorf("Marshal failed after successful Unmarshal: %v", err)
        }
    })
}

// Ejecutar: go test -fuzz=FuzzParseJSON -fuzztime=30s
```

### Prueba Fuzz con Múltiples Entradas

```go
func FuzzCompare(f *testing.F) {
    f.Add("hello", "world")
    f.Add("", "")
    f.Add("abc", "abc")

    f.Fuzz(func(t *testing.T, a, b string) {
        result := Compare(a, b)

        // Propiedad: Compare(a, a) siempre debe ser igual a 0
        if a == b && result != 0 {
            t.Errorf("Compare(%q, %q) = %d; want 0", a, b, result)
        }

        // Propiedad: Compare(a, b) y Compare(b, a) deben tener signos opuestos
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

## Cobertura de Código

### Ejecutar Cobertura

```bash
# Cobertura básica
go test -cover ./...

# Generar perfil de cobertura
go test -coverprofile=coverage.out ./...

# Ver cobertura en el navegador
go tool cover -html=coverage.out

# Ver cobertura por función
go tool cover -func=coverage.out

# Cobertura con detección de condiciones de carrera
go test -race -coverprofile=coverage.out ./...
```

### Objetivos de Cobertura

| Tipo de Código | Objetivo |
|-----------|--------|
| Lógica de negocio crítica | 100% |
| APIs públicas | 90%+ |
| Código general | 80%+ |
| Código generado | Excluir |

### Excluir Código Generado de la Cobertura

```go
//go:generate mockgen -source=interface.go -destination=mock_interface.go

// En el perfil de cobertura, excluir con build tags:
// go test -cover -tags=!generate ./...
```

## Pruebas de Handlers HTTP

```go
func TestHealthHandler(t *testing.T) {
    // Crear request
    req := httptest.NewRequest(http.MethodGet, "/health", nil)
    w := httptest.NewRecorder()

    // Llamar handler
    HealthHandler(w, req)

    // Verificar respuesta
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

## Comandos de Prueba

```bash
# Ejecutar todas las pruebas
go test ./...

# Ejecutar pruebas con salida detallada
go test -v ./...

# Ejecutar prueba específica
go test -run TestAdd ./...

# Ejecutar pruebas que coincidan con patrón
go test -run "TestUser/Create" ./...

# Ejecutar pruebas con detector de condiciones de carrera
go test -race ./...

# Ejecutar pruebas con cobertura
go test -cover -coverprofile=coverage.out ./...

# Ejecutar solo pruebas cortas
go test -short ./...

# Ejecutar pruebas con timeout
go test -timeout 30s ./...

# Ejecutar benchmarks
go test -bench=. -benchmem ./...

# Ejecutar fuzzing
go test -fuzz=FuzzParse -fuzztime=30s ./...

# Contar ejecuciones de prueba (para detección de pruebas inestables)
go test -count=10 ./...
```

## Buenas Prácticas

**HACER:**
- Escribir pruebas PRIMERO (TDD)
- Usar pruebas basadas en tablas para cobertura comprensiva
- Probar comportamiento, no implementación
- Usar `t.Helper()` en funciones helper
- Usar `t.Parallel()` para pruebas independientes
- Limpiar recursos con `t.Cleanup()`
- Usar nombres de prueba significativos que describan el escenario

**NO HACER:**
- Probar funciones privadas directamente (probar a través de la API pública)
- Usar `time.Sleep()` en pruebas (usar canales o condiciones)
- Ignorar pruebas inestables (corregirlas o eliminarlas)
- Mockear todo (preferir pruebas de integración cuando sea posible)
- Omitir pruebas de rutas de error

## Integración con CI/CD

```yaml
# Ejemplo de GitHub Actions
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

**Recuerda**: Las pruebas son documentación. Muestran cómo se pretende usar tu código. Escríbelas con claridad y mantenlas actualizadas.
