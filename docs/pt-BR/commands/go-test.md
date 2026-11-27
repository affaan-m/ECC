---
description: Impõe fluxo de TDD para Go. Escreva table-driven tests primeiro e depois implemente. Verifique cobertura de 80%+ com go test -cover.
---

# Comando TDD Go

Este comando impõe a metodologia de desenvolvimento orientado a testes para código Go usando padrões idiomáticos de teste em Go.

## O Que Este Comando Faz

1. **Definir Tipos/Interfaces**: Estrutura assinaturas de função primeiro
2. **Escrever Table-Driven Tests**: Criar casos de teste abrangentes (RED)
3. **Rodar Testes**: Verificar que os testes falham pelo motivo certo
4. **Implementar Código**: Escrever código mínimo para passar (GREEN)
5. **Refatorar**: Melhorar mantendo testes verdes
6. **Checar Cobertura**: Garantir 80%+ de cobertura

## Quando Usar

Use `/go-test` quando:
- Implementar novas funções Go
- Adicionar cobertura de testes a código existente
- Corrigir bugs (escreva primeiro o teste que falha)
- Construir lógica de negócio crítica
- Aprender fluxo TDD em Go

## Ciclo TDD

```
RED     → Write failing table-driven test
GREEN   → Implement minimal code to pass
REFACTOR → Improve code, tests stay green
REPEAT  → Next test case
```

## Exemplo de Sessão

````
User: /go-test I need a function to validate email addresses

Agent:
# TDD Session: Email Validator

## Step 1: Define Interface

```go
// validator/email.go
package validator

// ValidateEmail checks if the given string is a valid email address.
// Returns nil if valid, error describing the issue otherwise.
func ValidateEmail(email string) error {
    panic("not implemented")
}
```

## Step 2: Write Table-Driven Tests (RED)

```go
// validator/email_test.go
package validator

import (
    "testing"
)

func TestValidateEmail(t *testing.T) {
    tests := []struct {
        name    string
        email   string
        wantErr bool
    }{
        // Valid emails
        {"simple email", "user@example.com", false},
        {"with subdomain", "user@mail.example.com", false},
        {"with plus", "user+tag@example.com", false},
        {"with dots", "first.last@example.com", false},

        // Invalid emails
        {"empty string", "", true},
        {"no at sign", "userexample.com", true},
        {"no domain", "user@", true},
        {"no local part", "@example.com", true},
        {"double at", "user@@example.com", true},
        {"spaces", "user @example.com", true},
        {"no tld", "user@example", true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := ValidateEmail(tt.email)
            if tt.wantErr && err == nil {
                t.Errorf("ValidateEmail(%q) = nil; want error", tt.email)
            }
            if !tt.wantErr && err != nil {
                t.Errorf("ValidateEmail(%q) = %v; want nil", tt.email, err)
            }
        })
    }
}
```

## Step 3: Run Tests - Verify FAIL

```bash
$ go test ./validator/...

--- FAIL: TestValidateEmail (0.00s)
    --- FAIL: TestValidateEmail/simple_email (0.00s)
        panic: not implemented

FAIL
```

✓ Tests fail as expected (panic).

## Step 4: Implement Minimal Code (GREEN)

```go
// validator/email.go
package validator

import (
    "errors"
    "regexp"
)

var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)

var (
    ErrEmailEmpty   = errors.New("email cannot be empty")
    ErrEmailInvalid = errors.New("email format is invalid")
)

func ValidateEmail(email string) error {
    if email == "" {
        return ErrEmailEmpty
    }
    if !emailRegex.MatchString(email) {
        return ErrEmailInvalid
    }
    return nil
}
```

## Step 5: Run Tests - Verify PASS

```bash
$ go test ./validator/...

PASS
ok      project/validator    0.003s
```

✓ All tests passing!

## Step 6: Check Coverage

```bash
$ go test -cover ./validator/...

PASS
coverage: 100.0% of statements
ok      project/validator    0.003s
```

✓ Coverage: 100%

## TDD Complete!
````

## Padrões de Teste

### Table-Driven Tests
```go
tests := []struct {
    name     string
    input    InputType
    want     OutputType
    wantErr  bool
}{
    {"case 1", input1, want1, false},
    {"case 2", input2, want2, true},
}

for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) {
        got, err := Function(tt.input)
        // assertions
    })
}
```

### Testes Paralelos
```go
for _, tt := range tests {
    tt := tt // Capture
    t.Run(tt.name, func(t *testing.T) {
        t.Parallel()
        // test body
    })
}
```

### Helpers de Teste
```go
func setupTestDB(t *testing.T) *sql.DB {
    t.Helper()
    db := createDB()
    t.Cleanup(func() { db.Close() })
    return db
}
```

## Comandos de Cobertura

```bash
# Basic coverage
go test -cover ./...

# Coverage profile
go test -coverprofile=coverage.out ./...

# View in browser
go tool cover -html=coverage.out

# Coverage by function
go tool cover -func=coverage.out

# With race detection
go test -race -cover ./...
```

## Metas de Cobertura

| Code Type | Target |
|-----------|--------|
| Critical business logic | 100% |
| Public APIs | 90%+ |
| General code | 80%+ |
| Generated code | Exclude |

## Boas Práticas de TDD

**DO:**
- Escreva teste PRIMEIRO, antes de qualquer implementação
- Rode testes após cada mudança
- Use table-driven tests para cobertura abrangente
- Teste comportamento, não detalhes de implementação
- Inclua casos de borda (empty, nil, max values)

**DON'T:**
- Escrever implementação antes dos testes
- Pular a fase RED
- Testar funções privadas diretamente
- Usar `time.Sleep` em testes
- Ignorar testes flaky

## Comandos Relacionados

- `/go-build` - Corrigir erros de build
- `/go-review` - Revisar código após implementação
- `/verify` - Rodar loop completo de verificação

## Relacionado

- Skill: `skills/golang-testing/`
- Skill: `skills/tdd-workflow/`
