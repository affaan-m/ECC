---
description: Extraer patrones reutilizables de la sesión actual y guardarlos como skills candidatas o guía.
---

# /learn - Extraer Patrones Reutilizables

Analizar la sesión actual y extraer cualquier patrón que valga la pena guardar como skills.

## Activador

Ejecutar `/learn` en cualquier momento durante una sesión cuando se haya resuelto un problema no trivial.

## Qué Extraer

Buscar:

1. **Patrones de Resolución de Errores**
   - ¿Qué error ocurrió?
   - ¿Cuál fue la causa raíz?
   - ¿Qué lo solucionó?
   - ¿Es reutilizable para errores similares?

2. **Técnicas de Depuración**
   - Pasos de depuración no obvios
   - Combinaciones de herramientas que funcionaron
   - Patrones de diagnóstico

3. **Soluciones Alternativas**
   - Peculiaridades de librerías
   - Limitaciones de API
   - Correcciones específicas de versión

4. **Patrones Específicos del Proyecto**
   - Convenciones de la base de código descubiertas
   - Decisiones arquitectónicas tomadas
   - Patrones de integración

## Formato de Salida

Crear un archivo de skill en `~/.claude/skills/learned/[nombre-del-patron].md`:

```markdown
# [Nombre Descriptivo del Patrón]

**Extraído:** [Fecha]
**Contexto:** [Breve descripción de cuándo aplica]

## Problema
[Qué problema resuelve - ser específico]

## Solución
[El patrón/técnica/solución alternativa]

## Ejemplo
[Ejemplo de código si aplica]

## Cuándo Usar
[Condiciones de activación - qué debe activar esta skill]
```

## Proceso

1. Revisar la sesión en busca de patrones extraíbles
2. Identificar el insight más valioso/reutilizable
3. Redactar el archivo de skill
4. Pedir al usuario que confirme antes de guardar
5. Guardar en `~/.claude/skills/learned/`

## Notas

- No extraer correcciones triviales (typos, errores de sintaxis simples)
- No extraer problemas puntuales (interrupciones específicas de API, etc.)
- Enfocarse en patrones que ahorrarán tiempo en sesiones futuras
- Mantener las skills enfocadas - un patrón por skill
