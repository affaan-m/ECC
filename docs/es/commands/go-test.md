---
description: Reforzar el flujo de trabajo TDD para Go. Escribir pruebas table-driven primero, luego implementar. Verificar 80%+ de cobertura con go test -cover.
---

# Comando TDD de Go

Este comando refuerza la metodología de desarrollo guiado por pruebas para código Go usando patrones de testing idiomáticos de Go.

## Qué Hace Este Comando

1. **Definir Tipos/Interfaces**: Hacer scaffold de las firmas de funciones primero
2. **Escribir Pruebas Table-Driven**: Crear casos de prueba exhaustivos (ROJO)
3. **Ejecutar Pruebas**: Verificar que las pruebas fallan por la razón correcta
4. **Implementar Código**: Escribir el código mínimo para que pasen (VERDE)
5. **Refactorizar**: Mejorar mientras se mantienen las pruebas en verde
6. **Verificar Cobertura**: Asegurar 80%+ de cobertura

## Cuándo Usar

Usar `/go-test` cuando:
- Se implementan nuevas funciones de Go
- Se añade cobertura de pruebas a código existente
- Se corrigen bugs (escribir primero la prueba que falla)
- Se construye lógica de negocio crítica
- Se aprende el flujo de trabajo TDD en Go

## Ciclo TDD

```
ROJO     → Escribir prueba table-driven que falla
VERDE    → Implementar código mínimo para que pase
REFACTOR → Mejorar código, las pruebas se mantienen en verde
REPETIR  → Siguiente caso de prueba
```

## Ejemplo de Sesión

```
Usuario: /go-test Necesito una función para validar direcciones de email

Agente:
# Sesión TDD: Validador de Email

## Paso 1: Definir Interfaz

// validator/email.go
package validator

// ValidateEmail verifica si el string dado es una dirección de email válida.
// Retorna nil si es válido, error describiendo el problema de lo contrario.
func ValidateEmail(email string) error {
    panic("not implemented")
}

## Paso 2: Escribir Pruebas Table-Driven (ROJO)

// validator/email_test.go
func TestValidateEmail(t *testing.T) {
    tests := []struct {
        name    string
        email   string
        wantErr bool
    }{
        // Emails válidos
        {"email simple", "user@example.com", false},
        {"con subdominio", "user@mail.example.com", false},
        // Emails inválidos
        {"string vacío", "", true},
        {"sin arroba", "userexample.com", true},
        {"sin dominio", "user@", true},
    }
    // ...
}

## Paso 3: Ejecutar Pruebas - Verificar FALLO

$ go test ./validator/...
FAIL (panic: not implemented)
✓ Las pruebas fallan como se esperaba.

## Paso 4: Implementar Código Mínimo (VERDE)

var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)

func ValidateEmail(email string) error {
    if email == "" {
        return ErrEmailEmpty
    }
    if !emailRegex.MatchString(email) {
        return ErrEmailInvalid
    }
    return nil
}

## Paso 5: Ejecutar Pruebas - Verificar PASAN

$ go test ./validator/...
PASS ✓ Todas las pruebas pasando!

## Paso 6: Verificar Cobertura

$ go test -cover ./validator/...
coverage: 100.0% of statements
```

## Patrones de Prueba

### Pruebas Table-Driven
```go
tests := []struct {
    name     string
    input    InputType
    want     OutputType
    wantErr  bool
}{
    {"caso 1", input1, want1, false},
    {"caso 2", input2, want2, true},
}

for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) {
        got, err := Function(tt.input)
        // afirmaciones
    })
}
```

### Pruebas en Paralelo
```go
for _, tt := range tests {
    tt := tt // Capturar
    t.Run(tt.name, func(t *testing.T) {
        t.Parallel()
        // cuerpo de prueba
    })
}
```

## Comandos de Cobertura

```bash
# Cobertura básica
go test -cover ./...

# Perfil de cobertura
go test -coverprofile=coverage.out ./...

# Ver en navegador
go tool cover -html=coverage.out

# Cobertura por función
go tool cover -func=coverage.out

# Con detección de condiciones de carrera
go test -race -cover ./...
```

## Objetivos de Cobertura

| Tipo de Código | Objetivo |
|----------------|---------|
| Lógica de negocio crítica | 100% |
| APIs públicas | 90%+ |
| Código general | 80%+ |
| Código generado | Excluir |

## Mejores Prácticas de TDD

**HACER:**
- Escribir la prueba PRIMERO, antes de cualquier implementación
- Ejecutar las pruebas después de cada cambio
- Usar pruebas table-driven para cobertura exhaustiva
- Probar el comportamiento, no los detalles de implementación
- Incluir casos límite (vacío, nil, valores máximos)

**NO HACER:**
- Escribir implementación antes que las pruebas
- Saltar la fase ROJO
- Probar funciones privadas directamente
- Usar `time.Sleep` en las pruebas
- Ignorar las pruebas inestables

## Comandos Relacionados

- `/go-build` - Corregir errores de build
- `/go-review` - Revisar código después de la implementación

## Relacionado

- Skill: `skills/golang-testing/`
- Skill: `skills/tdd-workflow/`
