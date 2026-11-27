---
description: Revisión de código Go completa para patrones idiomáticos, seguridad de concurrencia, manejo de errores y seguridad. Invoca al agente go-reviewer.
---

# Revisión de Código Go

Este comando invoca al agente **go-reviewer** para una revisión de código Go completa y específica.

## Qué Hace Este Comando

1. **Identificar Cambios de Go**: Encontrar archivos `.go` modificados mediante `git diff`
2. **Ejecutar Análisis Estático**: Ejecutar `go vet`, `staticcheck` y `golangci-lint`
3. **Escaneo de Seguridad**: Verificar inyección SQL, inyección de comandos, condiciones de carrera
4. **Revisión de Concurrencia**: Analizar seguridad de goroutines, uso de canales, patrones de mutex
5. **Verificación de Go Idiomático**: Verificar que el código sigue las convenciones y mejores prácticas de Go
6. **Generar Reporte**: Categorizar problemas por severidad

## Cuándo Usar

Usar `/go-review` cuando:
- Después de escribir o modificar código Go
- Antes de hacer commit de cambios de Go
- Al revisar pull requests con código Go
- Al incorporarse a una nueva base de código de Go
- Al aprender patrones idiomáticos de Go

## Categorías de Revisión

### CRÍTICO (Debe Corregirse)
- Vulnerabilidades de inyección SQL/comandos
- Condiciones de carrera sin sincronización
- Fugas de goroutines
- Credenciales hardcodeadas
- Uso de punteros inseguros
- Errores ignorados en rutas críticas

### ALTO (Debería Corregirse)
- Manejo de errores sin context
- Panic en lugar de retorno de errores
- Context no propagado
- Canales sin buffer causando deadlocks
- Errores de interfaz no satisfecha
- Protección de mutex faltante

### MEDIO (Considerar)
- Patrones de código no idiomáticos
- Comentarios godoc faltantes en exports
- Concatenación de strings ineficiente
- Slice no preasignado
- Pruebas table-driven no usadas

## Verificaciones Automáticas Ejecutadas

```bash
# Análisis estático
go vet ./...

# Verificaciones avanzadas (si están instaladas)
staticcheck ./...
golangci-lint run

# Detección de condiciones de carrera
go build -race ./...

# Vulnerabilidades de seguridad
govulncheck ./...
```

## Ejemplo de Uso

```text
Usuario: /go-review

Agente:
# Reporte de Revisión de Código Go

## Archivos Revisados
- internal/handler/user.go (modificado)
- internal/service/auth.go (modificado)

## Resultados del Análisis Estático
✓ go vet: Sin problemas
✓ staticcheck: Sin problemas

## Problemas Encontrados

[CRÍTICO] Condición de Carrera
Archivo: internal/service/auth.go:45
Problema: Mapa compartido accedido sin sincronización
Fix: Usar sync.RWMutex o sync.Map

[ALTO] Context de Error Faltante
Archivo: internal/handler/user.go:28
Problema: Error retornado sin context
Fix: Envolver con context
return fmt.Errorf("get user %s: %w", userID, err)

## Resumen
- CRÍTICO: 1
- ALTO: 1
- MEDIO: 0

Recomendación: FALLAR: Bloquear merge hasta que se corrija el problema CRÍTICO
```

## Criterios de Aprobación

| Estado | Condición |
|--------|-----------|
| PASAR: Aprobar | Sin problemas CRÍTICOS o ALTOS |
| ADVERTENCIA | Solo problemas MEDIOS (fusionar con precaución) |
| FALLAR: Bloquear | Problemas CRÍTICOS o ALTOS encontrados |

## Integración con Otros Comandos

- Usar `/go-test` primero para asegurarse de que las pruebas pasen
- Usar `/go-build` si ocurren errores de build
- Usar `/go-review` antes de hacer commit
- Usar `/code-review` para preocupaciones no específicas de Go

## Relacionado

- Agente: `agents/go-reviewer.md`
- Skills: `skills/golang-patterns/`, `skills/golang-testing/`
