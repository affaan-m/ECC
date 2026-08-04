---
description: "Extraer patrones reutilizables de la sesión, autoevaluar la calidad antes de guardar y determinar la ubicación correcta (Global vs. Proyecto)."
---

# /learn-eval - Extraer, Evaluar y luego Guardar

Extiende `/learn` con una puerta de calidad, decisión de ubicación de guardado y conciencia de colocación del conocimiento antes de escribir cualquier archivo de skill.

## Qué Extraer

Buscar:

1. **Patrones de Resolución de Errores** — causa raíz + corrección + reutilizabilidad
2. **Técnicas de Depuración** — pasos no obvios, combinaciones de herramientas
3. **Soluciones Alternativas** — peculiaridades de librerías, limitaciones de API, correcciones específicas de versión
4. **Patrones Específicos del Proyecto** — convenciones, decisiones arquitectónicas, patrones de integración

## Proceso

1. Revisar la sesión en busca de patrones extraíbles
2. Identificar el insight más valioso/reutilizable

3. **Determinar la ubicación de guardado:**
   - Preguntar: "¿Este patrón sería útil en un proyecto diferente?"
   - **Global** (`~/.claude/skills/learned/`): Patrones genéricos usables en 2+ proyectos (compatibilidad bash, comportamiento de API LLM, técnicas de depuración, etc.)
   - **Proyecto** (`.claude/skills/learned/` en el proyecto actual): Conocimiento específico del proyecto (peculiaridades de un archivo de configuración particular, decisiones de arquitectura específicas del proyecto, etc.)
   - Ante la duda, elegir Global (mover Global → Proyecto es más fácil que al revés)

4. Redactar el archivo de skill usando este formato:

```markdown
---
name: nombre-del-patron
description: "Menos de 130 caracteres"
user-invocable: false
origin: auto-extracted
---

# [Nombre Descriptivo del Patrón]

**Extraído:** [Fecha]
**Contexto:** [Breve descripción de cuándo aplica]

## Problema
[Qué problema resuelve - ser específico]

## Solución
[El patrón/técnica/solución alternativa - con ejemplos de código]

## Cuándo Usar
[Condiciones de activación]
```

5. **Puerta de calidad — Lista de verificación + Veredicto holístico**

   ### 5a. Lista de verificación requerida (verificar leyendo los archivos reales)

   Ejecutar **todos** los siguientes antes de evaluar el borrador:

   - [ ] Hacer grep en `~/.claude/skills/` y archivos relevantes de `.claude/skills/` del proyecto por palabras clave para verificar superposición de contenido
   - [ ] Verificar MEMORY.md (tanto del proyecto como global) para superposición
   - [ ] Considerar si añadir a una skill existente sería suficiente
   - [ ] Confirmar que este es un patrón reutilizable, no una corrección puntual

   ### 5b. Veredicto holístico

   Sintetizar los resultados de la lista de verificación y la calidad del borrador, luego elegir **uno** de los siguientes:

   | Veredicto | Significado | Próxima Acción |
   |-----------|-------------|---------------|
   | **Guardar** | Único, específico, bien delimitado | Proceder al Paso 6 |
   | **Mejorar y luego Guardar** | Valioso pero necesita refinamiento | Listar mejoras → revisar → re-evaluar (una vez) |
   | **Absorber en [X]** | Debe añadirse a una skill existente | Mostrar skill objetivo y adiciones → Paso 6 |
   | **Descartar** | Trivial, redundante o demasiado abstracto | Explicar razonamiento y parar |

**Dimensiones de guía** (informando el veredicto, no puntuadas):

- **Especificidad y Accionabilidad**: Contiene ejemplos de código o comandos que son utilizables inmediatamente
- **Ajuste de Alcance**: El nombre, las condiciones de activación y el contenido están alineados y enfocados en un solo patrón
- **Unicidad**: Proporciona valor no cubierto por skills existentes (informado por los resultados de la lista de verificación)
- **Reutilizabilidad**: Existen escenarios de activación realistas en sesiones futuras

6. **Flujo de confirmación específico por veredicto**

- **Mejorar y luego Guardar**: Presentar las mejoras requeridas + borrador revisado + lista de verificación/veredicto actualizado después de una re-evaluación; si el veredicto revisado es **Guardar**, guardar después de confirmación del usuario, de lo contrario seguir el nuevo veredicto
- **Guardar**: Presentar ruta de guardado + resultados de lista de verificación + razón de veredicto de 1 línea + borrador completo → guardar después de confirmación del usuario
- **Absorber en [X]**: Presentar ruta objetivo + adiciones (formato diff) + resultados de lista de verificación + razón del veredicto → añadir después de confirmación del usuario
- **Descartar**: Mostrar solo resultados de lista de verificación + razonamiento (sin necesidad de confirmación)

7. Guardar / Absorber en la ubicación determinada

## Formato de Salida para el Paso 5

```
### Lista de Verificación
- [x] grep de skills/: sin superposición (o: superposición encontrada → detalles)
- [x] MEMORY.md: sin superposición (o: superposición encontrada → detalles)
- [x] Añadir a skill existente: nuevo archivo apropiado (o: debería añadirse a [X])
- [x] Reutilizabilidad: confirmada (o: caso único → Descartar)

### Veredicto: Guardar / Mejorar y luego Guardar / Absorber en [X] / Descartar

**Razonamiento:** (1-2 oraciones explicando el veredicto)
```

## Notas

- No extraer correcciones triviales (typos, errores de sintaxis simples)
- No extraer problemas puntuales (interrupciones específicas de API, etc.)
- Enfocarse en patrones que ahorrarán tiempo en sesiones futuras
- Mantener las skills enfocadas — un patrón por skill
- Cuando el veredicto es Absorber, añadir a la skill existente en lugar de crear un archivo nuevo
