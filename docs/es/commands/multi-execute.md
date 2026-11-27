---
description: Ejecutar un plan de implementación multi-modelo preservando a Claude como el único escritor del sistema de archivos.
---

# Execute - Ejecución Colaborativa Multi-Modelo

Ejecución colaborativa multi-modelo - Obtener prototipo del plan → Claude refactoriza e implementa → Auditoría multi-modelo y entrega.

$ARGUMENTS

---

## Protocolos Principales

- **Soberanía del Código**: Los modelos externos tienen **cero acceso de escritura al sistema de archivos**, todas las modificaciones por Claude
- **Refactorización de Prototipo Sucio**: Tratar el Unified Diff de Codex/Gemini como "prototipo sucio", debe refactorizarse a código de calidad de producción
- **Mecanismo de Parada**: No proceder a la siguiente fase hasta que la salida de la fase actual esté validada
- **Prerrequisito**: Solo ejecutar después de que el usuario responda explícitamente "Y" a la salida de `/ccg:plan`

---

## Flujo de Ejecución

**Tarea a Ejecutar**: $ARGUMENTS

### Fase 0: Leer Plan

`[Modo: Preparar]`

1. **Identificar Tipo de Entrada**:
   - Ruta de archivo de plan (ej. `.claude/plan/xxx.md`)
   - Descripción directa de tarea

2. **Leer Contenido del Plan**:
   - Si se proporciona ruta de archivo, leer y parsear
   - Extraer: tipo de tarea, pasos de implementación, archivos clave, SESSION_ID

3. **Enrutamiento por Tipo de Tarea**:

   | Tipo de Tarea | Detección | Ruta |
   |---------------|-----------|------|
   | **Frontend** | Páginas, componentes, UI, estilos | Gemini |
   | **Backend** | API, interfaces, base de datos, lógica | Codex |
   | **Fullstack** | Contiene tanto frontend como backend | Codex ∥ Gemini en paralelo |

---

### Fase 1: Recuperación Rápida de Contexto

`[Modo: Recuperación]`

Basado en la lista de "Archivos Clave" del plan, recuperar el contexto relevante del proyecto.

---

### Fase 3: Adquisición de Prototipo

`[Modo: Prototipo]`

**Enrutar según el Tipo de Tarea**:

#### Ruta A: Frontend/UI/Estilos → Gemini

1. Llamar a Gemini
2. Entrada: Contenido del plan + contexto recuperado + archivos objetivo
3. **Gemini es la autoridad de diseño frontend, su prototipo CSS/React/Vue es la línea base visual final**

#### Ruta B: Backend/Lógica/Algoritmos → Codex

1. Llamar a Codex
2. **Codex es la autoridad de lógica backend, aprovechar su razonamiento lógico y capacidades de depuración**

#### Ruta C: Fullstack → Llamadas en Paralelo

1. **Llamadas en Paralelo**
2. Esperar resultados completos de ambos modelos
3. Cada uno usa el `SESSION_ID` correspondiente del plan para `resume`

---

### Fase 4: Implementación de Código

`[Modo: Implementar]`

**Claude como Soberano del Código ejecuta los siguientes pasos**:

1. **Leer Diff**: Parsear el Unified Diff Patch retornado por Codex/Gemini
2. **Sandbox Mental**: Simular la aplicación del Diff a los archivos objetivo
3. **Refactorizar y Limpiar**: Refactorizar el "prototipo sucio" a **código altamente legible, mantenible y de nivel empresarial**
4. **Alcance Mínimo**: Cambios limitados solo al alcance del requisito
5. **Aplicar Cambios**: Usar herramientas Edit/Write para ejecutar las modificaciones reales

---

### Fase 5: Auditoría y Entrega

`[Modo: Auditoría]`

**Llamar en paralelo** a Codex y Gemini para revisión de código:

1. **Revisión de Codex**: Seguridad, rendimiento, manejo de errores, corrección lógica
2. **Revisión de Gemini**: Accesibilidad, consistencia de diseño, experiencia de usuario

Después de que pase la auditoría, reportar al usuario:

```markdown
## Ejecución Completa

### Resumen de Cambios
| Archivo | Operación | Descripción |
|---------|-----------|-------------|
| ruta/al/archivo.ts | Modificado | Descripción |

### Resultados de Auditoría
- Codex: <Pasó/Encontró N problemas>
- Gemini: <Pasó/Encontró N problemas>
```

---

## Reglas Clave

1. **Soberanía del Código** – Todas las modificaciones de archivos por Claude, los modelos externos tienen cero acceso de escritura
2. **Refactorización del Prototipo Sucio** – La salida de Codex/Gemini tratada como borrador, debe refactorizarse
3. **Reglas de Confianza** – Backend sigue a Codex, Frontend sigue a Gemini
4. **Cambios Mínimos** – Solo modificar el código necesario, sin efectos secundarios
5. **Auditoría Obligatoria** – Debe realizar revisión de código multi-modelo después de los cambios
