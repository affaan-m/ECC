---
name: golang-patterns
description: Patrones idiomáticos de Go, buenas prácticas y convenciones para construir aplicaciones Go robustas, eficientes y mantenibles.
origin: ECC
---

# Patrones de Desarrollo Go

Patrones idiomáticos de Go y buenas prácticas para construir aplicaciones robustas, eficientes y mantenibles.

## Cuándo Activar

- Escribir nuevo código Go
- Revisar código Go
- Refactorizar código Go existente
- Diseñar paquetes/módulos Go

## Principios Fundamentales

### 1. Simplicidad y Claridad

Go favorece la simplicidad sobre la astucia. El código debe ser obvio y fácil de leer.

```go
// Bien: Claro y directo
func GetUser(id string) (*User, error) {
    user, err := db.FindUser(id)
    if err != nil {
        return nil, fmt.Errorf("get user %s: %w", id, err)
    }
    return user, nil
}

// Mal: Demasiado ingenioso
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

### 2. Hacer que el Valor Cero Sea Útil

Diseñar tipos para que su valor cero sea inmediatamente usable sin inicialización.

```go
// Bien: El valor cero es útil
type Counter struct {
    mu    sync.Mutex
    count int // el valor cero es 0, listo para usar
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.count++
    c.mu.Unlock()
}

// Bien: bytes.Buffer funciona con el valor cero
var buf bytes.Buffer
buf.WriteString("hello")

// Mal: Requiere inicialización
type BadCounter struct {
    counts map[string]int // el mapa nil causará panic
}
```

### 3. Aceptar Interfaces, Retornar Structs

Las funciones deben aceptar parámetros de interfaz y retornar tipos concretos.

```go
// Bien: Acepta interfaz, retorna tipo concreto
func ProcessData(r io.Reader) (*Result, error) {
    data, err := io.ReadAll(r)
    if err != nil {
        return nil, err
    }
    return &Result{Data: data}, nil
}

// Mal: Retorna interfaz (oculta detalles de implementación innecesariamente)
func ProcessData(r io.Reader) (io.Reader, error) {
    // ...
}
```

## Patrones de Manejo de Errores

### Wrapping de Errores con Contexto

```go
// Bien: Envolver errores con contexto
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

### Tipos de Error Personalizados

```go
// Definir errores específicos del dominio
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation failed on %s: %s", e.Field, e.Message)
}

// Errores centinela para casos comunes
var (
    ErrNotFound     = errors.New("resource not found")
    ErrUnauthorized = errors.New("unauthorized")
    ErrInvalidInput = errors.New("invalid input")
)
```

### Verificación de Errores con errors.Is y errors.As

```go
func HandleError(err error) {
    // Verificar error específico
    if errors.Is(err, sql.ErrNoRows) {
        log.Println("No records found")
        return
    }

    // Verificar tipo de error
    var validationErr *ValidationError
    if errors.As(err, &validationErr) {
        log.Printf("Validation error on field %s: %s",
            validationErr.Field, validationErr.Message)
        return
    }

    // Error desconocido
    log.Printf("Unexpected error: %v", err)
}
```

### Nunca Ignorar Errores

```go
// Mal: Ignorar error con identificador en blanco
result, _ := doSomething()

// Bien: Manejar o documentar explícitamente por qué es seguro ignorar
result, err := doSomething()
if err != nil {
    return err
}

// Aceptable: Cuando el error realmente no importa (raro)
_ = writer.Close() // Limpieza de mejor esfuerzo, error registrado en otro lugar
```

## Patrones de Concurrencia

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

### Context para Cancelación y Timeouts

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

### Apagado Graceful

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

### errgroup para Goroutines Coordinadas

```go
import "golang.org/x/sync/errgroup"

func FetchAll(ctx context.Context, urls []string) ([][]byte, error) {
    g, ctx := errgroup.WithContext(ctx)
    results := make([][]byte, len(urls))

    for i, url := range urls {
        i, url := i, url // Capturar variables del bucle
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

### Evitar Goroutine Leaks

```go
// Mal: Goroutine leak si el context es cancelado
func leakyFetch(ctx context.Context, url string) <-chan []byte {
    ch := make(chan []byte)
    go func() {
        data, _ := fetch(url)
        ch <- data // Bloquea para siempre si no hay receptor
    }()
    return ch
}

// Bien: Maneja correctamente la cancelación
func safeFetch(ctx context.Context, url string) <-chan []byte {
    ch := make(chan []byte, 1) // Canal con buffer
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

## Diseño de Interfaces

### Interfaces Pequeñas y Enfocadas

```go
// Bien: Interfaces de un solo método
type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}

type Closer interface {
    Close() error
}

// Componer interfaces según se necesite
type ReadWriteCloser interface {
    Reader
    Writer
    Closer
}
```

### Definir Interfaces Donde Se Usan

```go
// En el paquete consumidor, no en el proveedor
package service

// UserStore define lo que este servicio necesita
type UserStore interface {
    GetUser(id string) (*User, error)
    SaveUser(user *User) error
}

type Service struct {
    store UserStore
}

// La implementación concreta puede estar en otro paquete
// No necesita conocer esta interfaz
```

### Comportamiento Opcional con Type Assertions

```go
type Flusher interface {
    Flush() error
}

func WriteAndFlush(w io.Writer, data []byte) error {
    if _, err := w.Write(data); err != nil {
        return err
    }

    // Hacer flush si está soportado
    if f, ok := w.(Flusher); ok {
        return f.Flush()
    }
    return nil
}
```

## Organización de Paquetes

### Layout Estándar del Proyecto

```text
myproject/
├── cmd/
│   └── myapp/
│       └── main.go           # Punto de entrada
├── internal/
│   ├── handler/              # Handlers HTTP
│   ├── service/              # Lógica de negocio
│   ├── repository/           # Acceso a datos
│   └── config/               # Configuración
├── pkg/
│   └── client/               # Cliente de API pública
├── api/
│   └── v1/                   # Definiciones de API (proto, OpenAPI)
├── testdata/                 # Fixtures de prueba
├── go.mod
├── go.sum
└── Makefile
```

### Nomenclatura de Paquetes

```go
// Bien: Corto, minúsculas, sin guiones bajos
package http
package json
package user

// Mal: Verboso, mayúsculas mixtas, o redundante
package httpHandler
package json_parser
package userService // Sufijo 'Service' redundante
```

### Evitar Estado a Nivel de Paquete

```go
// Mal: Estado global mutable
var db *sql.DB

func init() {
    db, _ = sql.Open("postgres", os.Getenv("DATABASE_URL"))
}

// Bien: Inyección de dependencias
type Server struct {
    db *sql.DB
}

func NewServer(db *sql.DB) *Server {
    return &Server{db: db}
}
```

## Diseño de Structs

### Patrón de Opciones Funcionales

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
        timeout: 30 * time.Second, // por defecto
        logger:  log.Default(),    // por defecto
    }
    for _, opt := range opts {
        opt(s)
    }
    return s
}

// Uso
server := NewServer(":8080",
    WithTimeout(60*time.Second),
    WithLogger(customLogger),
)
```

### Embedding para Composición

```go
type Logger struct {
    prefix string
}

func (l *Logger) Log(msg string) {
    fmt.Printf("[%s] %s\n", l.prefix, msg)
}

type Server struct {
    *Logger // Embedding - Server obtiene el método Log
    addr    string
}

func NewServer(addr string) *Server {
    return &Server{
        Logger: &Logger{prefix: "SERVER"},
        addr:   addr,
    }
}

// Uso
s := NewServer(":8080")
s.Log("Starting...") // Llama al Logger.Log embebido
```

## Memoria y Rendimiento

### Pre-asignar Slices Cuando Se Conoce el Tamaño

```go
// Mal: El slice crece múltiples veces
func processItems(items []Item) []Result {
    var results []Result
    for _, item := range items {
        results = append(results, process(item))
    }
    return results
}

// Bien: Asignación única
func processItems(items []Item) []Result {
    results := make([]Result, 0, len(items))
    for _, item := range items {
        results = append(results, process(item))
    }
    return results
}
```

### Usar sync.Pool para Asignaciones Frecuentes

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
    // Procesar...
    return buf.Bytes()
}
```

### Evitar Concatenación de Strings en Bucles

```go
// Mal: Crea muchas asignaciones de string
func join(parts []string) string {
    var result string
    for _, p := range parts {
        result += p + ","
    }
    return result
}

// Bien: Asignación única con strings.Builder
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

// Mejor: Usar la librería estándar
func join(parts []string) string {
    return strings.Join(parts, ",")
}
```

## Integración con Herramientas Go

### Comandos Esenciales

```bash
# Build y ejecutar
go build ./...
go run ./cmd/myapp

# Pruebas
go test ./...
go test -race ./...
go test -cover ./...

# Análisis estático
go vet ./...
staticcheck ./...
golangci-lint run

# Gestión de módulos
go mod tidy
go mod verify

# Formato
gofmt -w .
goimports -w .
```

### Configuración Recomendada de Linter (.golangci.yml)

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
    check-shadowing: true

issues:
  exclude-use-default: false
```

## Referencia Rápida: Modismos de Go

| Modismo | Descripción |
|-------|-------------|
| Aceptar interfaces, retornar structs | Las funciones aceptan parámetros de interfaz, retornan tipos concretos |
| Los errores son valores | Tratar errores como valores de primera clase, no como excepciones |
| No comunicarse compartiendo memoria | Usar canales para coordinación entre goroutines |
| Hacer que el valor cero sea útil | Los tipos deben funcionar sin inicialización explícita |
| Un poco de copia es mejor que una pequeña dependencia | Evitar dependencias externas innecesarias |
| Claro es mejor que inteligente | Priorizar legibilidad sobre astucia |
| gofmt no es favorito de nadie pero sí amigo de todos | Siempre formatear con gofmt/goimports |
| Retornar temprano | Manejar errores primero, mantener el camino feliz sin indentar |

## Anti-Patrones a Evitar

```go
// Mal: Retornos naked en funciones largas
func process() (result int, err error) {
    // ... 50 líneas ...
    return // ¿Qué se está retornando?
}

// Mal: Usar panic para control de flujo
func GetUser(id string) *User {
    user, err := db.Find(id)
    if err != nil {
        panic(err) // No hacer esto
    }
    return user
}

// Mal: Pasar context en struct
type Request struct {
    ctx context.Context // El context debería ser el primer parámetro
    ID  string
}

// Bien: Context como primer parámetro
func ProcessRequest(ctx context.Context, id string) error {
    // ...
}

// Mal: Mezclar receptores de valor y puntero
type Counter struct{ n int }
func (c Counter) Value() int { return c.n }    // Receptor de valor
func (c *Counter) Increment() { c.n++ }        // Receptor de puntero
// Elegir un estilo y ser consistente
```

**Recuerda**: El código Go debe ser aburrido de la mejor manera — predecible, consistente y fácil de entender. Ante la duda, mantenerlo simple.
