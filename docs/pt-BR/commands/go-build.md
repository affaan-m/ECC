---
description: Corrija erros de build em Go, avisos de go vet e problemas de lint incrementalmente. Invoca o agente go-build-resolver para correções mínimas e cirúrgicas.
---

# Build e Correção Go

Este comando invoca o agente **go-build-resolver** para corrigir erros de build Go incrementalmente com mudanças mínimas.

## O Que Este Comando Faz

1. **Rodar Diagnósticos**: Executa `go build`, `go vet`, `staticcheck`
2. **Parsear Erros**: Agrupa por arquivo e ordena por severidade
3. **Corrigir Incrementalmente**: Um erro por vez
4. **Verificar Cada Correção**: Roda build de novo após cada mudança
5. **Reportar Resumo**: Mostra o que foi corrigido e o que resta

## Quando Usar

Use `/go-build` quando:
- `go build ./...` falhar com erros
- `go vet ./...` reportar problemas
- `golangci-lint run` mostrar avisos
- Dependências do módulo estiverem quebradas
- Após puxar mudanças que quebraram o build

## Comandos de Diagnóstico Executados

```bash
# Primary build check
go build ./...

# Static analysis
go vet ./...

# Extended linting (if available)
staticcheck ./...
golangci-lint run

# Module issues
go mod verify
go mod tidy -v
```

## Exemplo de Sessão

```text
User: /go-build

Agent:
# Go Build Resolution

## Initial Diagnostics

```bash
$ go build ./...
internal/service/user.go:25:15: undefined: UserRepository
internal/handler/api.go:42:9: cannot use x (type string) as type int
internal/handler/api.go:58:2: missing return at end of function
```

Errors found: 3

## Fix 1: Undefined Identifier

File: internal/service/user.go:25
Error: undefined: UserRepository
Cause: Missing import

```go
// Added import
import "project/internal/repository"

// Changed
var repo UserRepository
// To
var repo repository.UserRepository
```

```bash
$ go build ./...
# 2 errors remaining
```

## Fix 2: Type Mismatch

File: internal/handler/api.go:42
Error: cannot use x (type string) as type int

```go
// Changed
count := params.Get("count")
// To
countStr := params.Get("count")
count, _ := strconv.Atoi(countStr)
```

```bash
$ go build ./...
# 1 error remaining
```

## Fix 3: Missing Return

File: internal/handler/api.go:58
Error: missing return at end of function

```go
func GetUser(id string) (*User, error) {
    if id == "" {
        return nil, ErrInvalidID
    }
    user := findUser(id)
    // Added missing return
    return user, nil
}
```

```bash
$ go build ./...
# Build successful!
```

## Final Verification

```bash
$ go vet ./...
# No issues

$ go test ./...
ok      project/internal/service   0.015s
ok      project/internal/handler   0.023s
```

## Summary

| Metric | Count |
|--------|-------|
| Build errors fixed | 3 |
| Vet warnings fixed | 0 |
| Files modified | 2 |
| Remaining issues | 0 |

Build Status: PASS: SUCCESS
```

## Erros Comuns Corrigidos

| Error | Typical Fix |
|-------|-------------|
| `undefined: X` | Add import or fix typo |
| `cannot use X as Y` | Type conversion or fix assignment |
| `missing return` | Add return statement |
| `X does not implement Y` | Add missing method |
| `import cycle` | Restructure packages |
| `declared but not used` | Remove or use variable |
| `cannot find package` | `go get` or `go mod tidy` |

## Estratégia de Correção

1. **Erros de build primeiro** - O código precisa compilar
2. **Avisos do vet depois** - Corrigir construções suspeitas
3. **Avisos de lint por último** - Estilo e boas práticas
4. **Uma correção por vez** - Verificar cada mudança
5. **Mudanças mínimas** - Não refatorar, apenas corrigir

## Condições de Parada

O agente vai parar e reportar se:
- O mesmo erro persistir após 3 tentativas
- A correção introduzir mais erros
- Exigir mudanças arquiteturais
- Faltarem dependências externas

## Comandos Relacionados

- `/go-test` - Rode testes após o build passar
- `/go-review` - Revise qualidade do código
- `/verify` - Loop completo de verificação

## Relacionado

- Agent: `agents/go-build-resolver.md`
- Skill: `skills/golang-patterns/`
