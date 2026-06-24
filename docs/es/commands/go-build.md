---
description: Corregir errores de build de Go, advertencias de go vet y problemas del linter de forma incremental. Invoca al agente go-build-resolver para correcciones mínimas y quirúrgicas.
---

# Go Build y Corrección

Este comando invoca al agente **go-build-resolver** para corregir incrementalmente errores de build de Go con cambios mínimos.

## Qué Hace Este Comando

1. **Ejecutar Diagnósticos**: Ejecutar `go build`, `go vet`, `staticcheck`
2. **Parsear Errores**: Agrupar por archivo y ordenar por severidad
3. **Corregir Incrementalmente**: Un error a la vez
4. **Verificar Cada Corrección**: Re-ejecutar el build después de cada cambio
5. **Reportar Resumen**: Mostrar qué se corrigió y qué queda pendiente

## Cuándo Usar

Usar `/go-build` cuando:
- `go build ./...` falla con errores
- `go vet ./...` reporta problemas
- `golangci-lint run` muestra advertencias
- Las dependencias de módulos están rotas
- Después de hacer pull de cambios que rompen el build

## Comandos de Diagnóstico Ejecutados

```bash
# Verificación de build principal
go build ./...

# Análisis estático
go vet ./...

# Linting extendido (si está disponible)
staticcheck ./...
golangci-lint run

# Problemas de módulos
go mod verify
go mod tidy -v
```

## Ejemplo de Sesión

```text
Usuario: /go-build

Agente:
# Resolución de Build de Go

## Diagnósticos Iniciales

$ go build ./...
internal/service/user.go:25:15: undefined: UserRepository
internal/handler/api.go:42:9: cannot use x (type string) as type int
internal/handler/api.go:58:2: missing return at end of function

Errores encontrados: 3

## Corrección 1: Identificador Indefinido

Archivo: internal/service/user.go:25
Error: undefined: UserRepository
Causa: Import faltante

// Import añadido
import "project/internal/repository"

// Cambiado
var repo UserRepository
// A
var repo repository.UserRepository

$ go build ./...
# 2 errores restantes

## Corrección 2: Incompatibilidad de Tipos

Archivo: internal/handler/api.go:42
Error: cannot use x (type string) as type int

// Cambiado
count := params.Get("count")
// A
countStr := params.Get("count")
count, _ := strconv.Atoi(countStr)

$ go build ./...
# 1 error restante

## Corrección 3: Return Faltante

Archivo: internal/handler/api.go:58
Error: missing return at end of function

func GetUser(id string) (*User, error) {
    if id == "" {
        return nil, ErrInvalidID
    }
    user := findUser(id)
    // Return añadido
    return user, nil
}

$ go build ./...
# ¡Build exitoso!

## Verificación Final

$ go vet ./...
# Sin problemas

$ go test ./...
ok      project/internal/service   0.015s
ok      project/internal/handler   0.023s

## Resumen

| Métrica | Cantidad |
|---------|---------|
| Errores de build corregidos | 3 |
| Advertencias de vet corregidas | 0 |
| Archivos modificados | 2 |
| Problemas restantes | 0 |

Estado del Build: ÉXITO
```

## Errores Comunes Corregidos

| Error | Corrección Típica |
|-------|-----------------|
| `undefined: X` | Añadir import o corregir typo |
| `cannot use X as Y` | Conversión de tipo o corregir asignación |
| `missing return` | Añadir sentencia return |
| `X does not implement Y` | Añadir método faltante |
| `import cycle` | Reestructurar paquetes |
| `declared but not used` | Eliminar o usar la variable |
| `cannot find package` | `go get` o `go mod tidy` |

## Estrategia de Corrección

1. **Errores de build primero** - El código debe compilar
2. **Advertencias de vet segundo** - Corregir construcciones sospechosas
3. **Advertencias del linter tercero** - Estilo y mejores prácticas
4. **Una corrección a la vez** - Verificar cada cambio
5. **Cambios mínimos** - No refactorizar, solo corregir

## Condiciones de Parada

El agente se detendrá e informará si:
- El mismo error persiste después de 3 intentos
- La corrección introduce más errores
- Requiere cambios arquitectónicos
- Faltan dependencias externas

## Comandos Relacionados

- `/go-test` - Ejecutar pruebas después de que el build tenga éxito
- `/go-review` - Revisar la calidad del código

## Relacionado

- Agente: `agents/go-build-resolver.md`
- Skill: `skills/golang-patterns/`
