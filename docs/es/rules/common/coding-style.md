# Estilo de Código

## Inmutabilidad (CRÍTICO)

SIEMPRE crear objetos nuevos, NUNCA mutar los existentes:

```
// Pseudocódigo
INCORRECTO:  modify(original, campo, valor) → modifica original in-place
CORRECTO:    update(original, campo, valor) → retorna nueva copia con el cambio
```

Justificación: Los datos inmutables previenen efectos secundarios ocultos, facilitan la depuración y permiten concurrencia segura.

## Principios Fundamentales

### KISS (Keep It Simple)

- Preferir la solución más simple que realmente funcione
- Evitar optimización prematura
- Optimizar para claridad, no para ingeniosidad

### DRY (Don't Repeat Yourself)

- Extraer lógica repetida en funciones o utilidades compartidas
- Evitar la deriva por copiar y pegar implementaciones
- Introducir abstracciones cuando la repetición es real, no especulativa

### YAGNI (You Aren't Gonna Need It)

- No construir features o abstracciones antes de que sean necesarias
- Evitar generalidad especulativa
- Comenzar simple, luego refactorizar cuando la presión es real

## Organización de Archivos

MUCHOS ARCHIVOS PEQUEÑOS > POCOS ARCHIVOS GRANDES:
- Alta cohesión, bajo acoplamiento
- 200-400 líneas típico, 800 máximo
- Extraer utilidades de módulos grandes
- Organizar por feature/dominio, no por tipo

## Manejo de Errores

SIEMPRE manejar errores de forma exhaustiva:
- Manejar errores explícitamente en cada nivel
- Proporcionar mensajes de error amigables en código orientado a la UI
- Registrar contexto detallado del error en el lado del servidor
- Nunca silenciar errores

## Validación de Entrada

SIEMPRE validar en los límites del sistema:
- Validar toda la entrada del usuario antes de procesarla
- Usar validación basada en esquemas donde esté disponible
- Fallar rápido con mensajes de error claros
- Nunca confiar en datos externos (respuestas de API, entrada de usuario, contenido de archivos)

## Convenciones de Nomenclatura

- Variables y funciones: `camelCase` con nombres descriptivos
- Booleanos: preferir prefijos `is`, `has`, `should`, o `can`
- Interfaces, tipos y componentes: `PascalCase`
- Constantes: `UPPER_SNAKE_CASE`
- Custom hooks: `camelCase` con prefijo `use`

## Code Smells a Evitar

### Anidamiento Profundo

Preferir retornos anticipados sobre condicionales anidados cuando la lógica empieza a acumularse.

### Números Mágicos

Usar constantes nombradas para umbrales, retrasos y límites significativos.

### Funciones Largas

Dividir funciones grandes en piezas enfocadas con responsabilidades claras.

## Lista de Verificación de Calidad de Código

Antes de marcar el trabajo como completo:
- [ ] El código es legible y bien nombrado
- [ ] Las funciones son pequeñas (<50 líneas)
- [ ] Los archivos están enfocados (<800 líneas)
- [ ] Sin anidamiento profundo (>4 niveles)
- [ ] Manejo de errores apropiado
- [ ] Sin valores hardcodeados (usar constantes o configuración)
- [ ] Sin mutación (patrones inmutables usados)
