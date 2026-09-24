# Requisitos de Pruebas

## Cobertura Mínima de Pruebas: 80%

Tipos de Pruebas (TODOS requeridos):
1. **Pruebas Unitarias** - Funciones individuales, utilidades, componentes
2. **Pruebas de Integración** - Endpoints de API, operaciones de base de datos
3. **Pruebas E2E** - Flujos de usuario críticos (framework elegido por lenguaje)

## Desarrollo Guiado por Pruebas

Flujo de trabajo OBLIGATORIO:
1. Escribir la prueba primero (ROJO)
2. Ejecutar la prueba - debe FALLAR
3. Escribir la implementación mínima (VERDE)
4. Ejecutar la prueba - debe PASAR
5. Refactorizar (MEJORAR)
6. Verificar cobertura (80%+)

## Solución de Problemas en Fallos de Pruebas

1. Usar el agente **tdd-guide**
2. Verificar el aislamiento de las pruebas
3. Verificar que los mocks sean correctos
4. Corregir la implementación, no las pruebas (a menos que las pruebas estén equivocadas)

## Soporte de Agentes

- **tdd-guide** - Usar PROACTIVAMENTE para nuevas features, aplica escribir-pruebas-primero

## Estructura de Pruebas (Patrón AAA)

Preferir la estructura Arrange-Act-Assert para las pruebas:

```typescript
test('calcula la similitud correctamente', () => {
  // Arrange
  const vector1 = [1, 0, 0]
  const vector2 = [0, 1, 0]

  // Act
  const similarity = calculateCosineSimilarity(vector1, vector2)

  // Assert
  expect(similarity).toBe(0)
})
```

### Nomenclatura de Pruebas

Usar nombres descriptivos que expliquen el comportamiento bajo prueba:

```typescript
test('retorna array vacío cuando ningún mercado coincide con la consulta', () => {})
test('lanza error cuando falta la clave de API', () => {})
test('cae de vuelta a búsqueda por substring cuando Redis no está disponible', () => {})
```
