---
description: Revisão completa de código Go para padrões idiomáticos, segurança de concorrência, tratamento de erro e segurança. Invoca o agente go-reviewer.
---

# Code Review Go

Este comando invoca o agente **go-reviewer** para revisão abrangente e específica de Go.

## O Que Este Comando Faz

1. **Identificar Mudanças Go**: Encontra arquivos `.go` modificados via `git diff`
2. **Rodar Análise Estática**: Executa `go vet`, `staticcheck` e `golangci-lint`
3. **Varredura de Segurança**: Verifica SQL injection, command injection e race conditions
4. **Revisão de Concorrência**: Analisa segurança de goroutines, uso de channels e padrões com mutex
5. **Checagem de Go Idiomático**: Verifica se o código segue convenções e boas práticas de Go
6. **Gerar Relatório**: Categoriza problemas por severidade

## Quando Usar

Use `/go-review` quando:
- Após escrever ou modificar código Go
- Antes de commitar mudanças Go
- Ao revisar pull requests com código Go
- Ao entrar em um novo codebase Go
- Ao aprender padrões idiomáticos Go

## Categorias de Revisão

### CRITICAL (Obrigatório Corrigir)
- Vulnerabilidades de SQL/Command injection
- Race conditions sem sincronização
- Vazamento de goroutine
- Credenciais hardcoded
- Uso inseguro de ponteiros
- Erros ignorados em caminhos críticos

### HIGH (Deve Corrigir)
- Falta de wrapping de erro com contexto
- Panic em vez de retorno de erro
- Context não propagado
- Canais não bufferizados causando deadlock
- Erros de interface não satisfeita
- Falta de proteção com mutex

### MEDIUM (Considere)
- Padrões não idiomáticos
- Falta de comentários godoc em exports
- Concatenação de string ineficiente
- Slice sem pré-alocação
- Table-driven tests não usados

## Checagens Automáticas Executadas

```bash
# Static analysis
go vet ./...

# Advanced checks (if installed)
staticcheck ./...
golangci-lint run

# Race detection
go build -race ./...

# Security vulnerabilities
govulncheck ./...
```

## Exemplo de Uso

```text
User: /go-review

Agent:
# Go Code Review Report

## Files Reviewed
- internal/handler/user.go (modified)
- internal/service/auth.go (modified)

## Static Analysis Results
✓ go vet: No issues
✓ staticcheck: No issues

## Issues Found

[CRITICAL] Race Condition
File: internal/service/auth.go:45
Issue: Shared map accessed without synchronization
```go
var cache = map[string]*Session{}  // Concurrent access!

func GetSession(id string) *Session {
    return cache[id]  // Race condition
}
```
Fix: Use sync.RWMutex or sync.Map
```go
var (
    cache   = map[string]*Session{}
    cacheMu sync.RWMutex
)

func GetSession(id string) *Session {
    cacheMu.RLock()
    defer cacheMu.RUnlock()
    return cache[id]
}
```

[HIGH] Missing Error Context
File: internal/handler/user.go:28
Issue: Error returned without context
```go
return err  // No context
```
Fix: Wrap with context
```go
return fmt.Errorf("get user %s: %w", userID, err)
```

## Summary
- CRITICAL: 1
- HIGH: 1
- MEDIUM: 0

Recommendation: FAIL: Block merge until CRITICAL issue is fixed
```

## Critérios de Aprovação

| Status | Condição |
|--------|----------|
| PASS: Aprovado | Sem problemas CRÍTICO ou ALTO |
| WARNING: Aviso | Apenas problemas MÉDIOS (merge com cautela) |
| FAIL: Bloqueado | Problemas CRÍTICO ou ALTO encontrados |
## Integração com Outros Comandos

- Use `/go-test` primeiro para garantir que os testes passam
- Use `/go-build` se houver erros de build
- Use `/go-review` antes de commitar
- Use `/code-review` para preocupações não específicas de Go

## Relacionado

- Agent: `agents/go-reviewer.md`
- Skills: `skills/golang-patterns/`, `skills/golang-testing/`
