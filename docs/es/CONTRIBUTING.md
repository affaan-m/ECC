# Contribuir a Everything Claude Code

¡Gracias por querer contribuir! Este repositorio es un recurso comunitario para usuarios de Claude Code.

## Tabla de Contenidos

- [Qué Buscamos](#qué-buscamos)
- [Inicio Rápido](#inicio-rápido)
- [Contribuir Skills](#contribuir-skills)
- [Política de Adaptación de Skills](#política-de-adaptación-de-skills)
- [Contribuir Agentes](#contribuir-agentes)
- [Contribuir Hooks](#contribuir-hooks)
- [Contribuir Comandos](#contribuir-comandos)
- [MCP y Documentación (por ejemplo, Context7)](#mcp-y-documentación-por-ejemplo-context7)
- [Cross-Harness y Traducciones](#cross-harness-y-traducciones)
- [Proceso de Pull Request](#proceso-de-pull-request)

---

## Qué Buscamos

### Agentes
Nuevos agentes que manejen tareas específicas de forma eficiente:
- Revisores específicos de lenguaje (Python, Go, Rust)
- Expertos en frameworks (Django, Rails, Laravel, Spring)
- Especialistas en DevOps (Kubernetes, Terraform, CI/CD)
- Expertos de dominio (pipelines de ML, ingeniería de datos, móvil)

### Skills
Definiciones de flujos de trabajo y conocimiento de dominio:
- Mejores prácticas por lenguaje
- Patrones de frameworks
- Estrategias de prueba
- Guías de arquitectura

### Hooks
Automatizaciones útiles:
- Hooks de linting/formateo
- Verificaciones de seguridad
- Hooks de validación
- Hooks de notificación

### Comandos
Comandos slash que invocan flujos de trabajo útiles:
- Comandos de despliegue
- Comandos de prueba
- Comandos de generación de código

---

## Inicio Rápido

```bash
# 1. Hacer fork y clonar
gh repo fork affaan-m/everything-claude-code --clone
cd everything-claude-code

# 2. Crear una rama
git checkout -b feat/mi-contribucion

# 3. Añadir tu contribución (ver secciones abajo)

# 4. Probar localmente
cp -r skills/mi-skill ~/.claude/skills/  # para skills
# Luego probar con Claude Code

# 5. Enviar PR
git add . && git commit -m "feat: add mi-skill" && git push -u origin feat/mi-contribucion
```

---

## Contribuir Skills

Las skills son módulos de conocimiento que Claude Code carga según el contexto.

> **Guía Completa:** Para orientación detallada sobre cómo crear skills efectivas, consulta la [Guía de Desarrollo de Skills](../SKILL-DEVELOPMENT-GUIDE.md). Cubre:
> - Arquitectura y categorías de skills
> - Escribir contenido efectivo con ejemplos
> - Mejores prácticas y patrones comunes
> - Prueba y validación
> - Galería de ejemplos completos

### Estructura de Directorios

```
skills/
└── nombre-de-tu-skill/
    └── SKILL.md
```

### Plantilla de SKILL.md

```markdown
---
name: nombre-de-tu-skill
description: Descripción breve mostrada en la lista de skills y usada para activación automática
origin: ECC
---

# Título de Tu Skill

Resumen breve de lo que cubre esta skill.

## Cuándo Activar

Describe los escenarios donde Claude debería usar esta skill. Esto es fundamental para la activación automática.

## Conceptos Clave

Explica patrones y directrices principales.

## Ejemplos de Código

\`\`\`typescript
// Incluye ejemplos prácticos y probados
function ejemplo() {
  // Código bien comentado
}
\`\`\`

## Anti-Patrones

Muestra lo que NO se debe hacer con ejemplos.

## Mejores Prácticas

- Directrices accionables
- Qué hacer y qué no hacer
- Errores comunes que evitar

## Skills Relacionadas

Enlaza a skills complementarias (por ejemplo, `skill-relacionada-1`, `skill-relacionada-2`).
```

### Categorías de Skills

| Categoría | Propósito | Ejemplos |
|-----------|---------|----------|
| **Estándares de Lenguaje** | Modismos, convenciones, mejores prácticas | `python-patterns`, `golang-patterns` |
| **Patrones de Framework** | Orientación específica del framework | `django-patterns`, `nextjs-patterns` |
| **Flujo de Trabajo** | Procesos paso a paso | `tdd-workflow`, `refactoring-workflow` |
| **Conocimiento de Dominio** | Dominios especializados | `security-review`, `api-design` |
| **Integración de Herramientas** | Uso de herramientas/bibliotecas | `docker-patterns`, `supabase-patterns` |
| **Plantilla** | Plantillas de skills específicas del proyecto | `docs/examples/project-guidelines-template.md` |

### Política de Adaptación de Skills

Si estás adaptando una idea de otro repo, plugin, harness o pack de prompts personal, lee la [Política de Adaptación de Skills](../skill-adaptation-policy.md) antes de abrir el PR.

Versión corta:

- copia la idea subyacente, no la identidad del producto externo
- renombra la skill cuando ECC cambie o amplíe materialmente la superficie
- prefiere reglas, skills, scripts y MCPs nativos de ECC sobre nuevas dependencias de terceros por defecto
- no publiques una skill cuyo valor principal sea indicarle a los usuarios que instalen un paquete no verificado

### Lista de Verificación de Skills

- [ ] Enfocada en un dominio/tecnología (no demasiado amplia)
- [ ] Incluye sección "Cuándo Activar" para activación automática
- [ ] Incluye ejemplos de código prácticos y reutilizables
- [ ] Muestra anti-patrones (qué NO hacer)
- [ ] Menos de 500 líneas (800 máx)
- [ ] Usa encabezados de sección claros
- [ ] Probada con Claude Code
- [ ] Enlaza a skills relacionadas
- [ ] Sin datos sensibles (claves de API, tokens, rutas)
- [ ] El frontmatter declara `name:` coincidiendo con el nombre del directorio
- [ ] El `description:` del frontmatter es una cadena en línea o escalar plegado (`>`) — no un bloque literal (`|`, `|-` o `|+`), que preserva los saltos de línea internos y rompe los renderizadores de tablas planas

### Skills de Ejemplo

| Skill | Categoría | Propósito |
|-------|----------|---------|
| `coding-standards/` | Estándares de Lenguaje | Patrones de TypeScript/JavaScript |
| `frontend-patterns/` | Patrones de Framework | Mejores prácticas de React y Next.js |
| `backend-patterns/` | Patrones de Framework | Patrones de API y base de datos |
| `security-review/` | Conocimiento de Dominio | Lista de verificación de seguridad |
| `tdd-workflow/` | Flujo de Trabajo | Proceso de desarrollo guiado por pruebas |
| `docs/examples/project-guidelines-template.md` | Plantilla | Plantilla de skill específica del proyecto |

---

## Contribuir Agentes

Los agentes son asistentes especializados invocados mediante la herramienta Task.

### Ubicación del Archivo

```
agents/nombre-de-tu-agente.md
```

### Plantilla de Agente

```markdown
---
name: nombre-de-tu-agente
description: Qué hace este agente y cuándo Claude debería invocarlo. ¡Sé específico!
tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"]
model: sonnet
---

Eres un especialista en [rol].

## Tu Rol

- Responsabilidad principal
- Responsabilidad secundaria
- Qué NO haces (límites)

## Flujo de Trabajo

### Paso 1: Comprender
Cómo abordas la tarea.

### Paso 2: Ejecutar
Cómo realizas el trabajo.

### Paso 3: Verificar
Cómo validas los resultados.

## Formato de Salida

Qué devuelves al usuario.

## Ejemplos

### Ejemplo: [Escenario]
Entrada: [qué proporciona el usuario]
Acción: [qué haces]
Salida: [qué devuelves]
```

### Campos del Agente

| Campo | Descripción | Opciones |
|-------|-------------|---------|
| `name` | Minúsculas, con guiones | `code-reviewer` |
| `description` | Usado para decidir cuándo invocar | ¡Sé específico! |
| `tools` | Solo lo que se necesita | `Read, Write, Edit, Bash, Grep, Glob, WebFetch, Task`, o nombres de herramientas MCP (por ejemplo `mcp__context7__resolve-library-id`, `mcp__context7__query-docs`) cuando el agente usa MCP |
| `model` | Nivel de complejidad | `haiku` (simple), `sonnet` (codificación), `opus` (complejo) |

### Agentes de Ejemplo

| Agente | Propósito |
|-------|---------|
| `tdd-guide.md` | Desarrollo guiado por pruebas |
| `code-reviewer.md` | Revisión de código |
| `security-reviewer.md` | Análisis de seguridad |
| `build-error-resolver.md` | Corregir errores de build |

---

## Contribuir Hooks

Los hooks son comportamientos automáticos disparados por eventos de Claude Code.

### Ubicación del Archivo

```
hooks/hooks.json
```

### Tipos de Hook

| Tipo | Disparador | Caso de Uso |
|------|---------|----------|
| `PreToolUse` | Antes de que ejecute la herramienta | Validar, advertir, bloquear |
| `PostToolUse` | Después de que ejecute la herramienta | Formatear, verificar, notificar |
| `SessionStart` | Comienza la sesión | Cargar contexto |
| `Stop` | Termina la sesión | Limpieza, auditoría |

### Formato de Hook

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "tool == \"Bash\" && tool_input.command matches \"rm -rf /\"",
        "hooks": [
          {
            "type": "command",
            "command": "echo '[Hook] BLOQUEADO: Comando peligroso' && exit 1"
          }
        ],
        "description": "Bloquear comandos rm peligrosos"
      }
    ]
  }
}
```

### Sintaxis del Matcher

```javascript
// Coincidir con herramientas específicas
tool == "Bash"
tool == "Edit"
tool == "Write"

// Coincidir con patrones de entrada
tool_input.command matches "npm install"
tool_input.file_path matches "\\.tsx?$"

// Combinar condiciones
tool == "Bash" && tool_input.command matches "git push"
```

### Lista de Verificación de Hooks

- [ ] El matcher es específico (no demasiado amplio)
- [ ] Incluye mensajes de error/info claros
- [ ] Usa códigos de salida correctos (`exit 1` bloquea, `exit 0` permite)
- [ ] Probado exhaustivamente
- [ ] Tiene descripción

---

## Contribuir Comandos

Los comandos son acciones invocadas por el usuario con `/nombre-del-comando`.

### Ubicación del Archivo

```
commands/tu-comando.md
```

### Plantilla de Comando

```markdown
---
description: Descripción breve mostrada en /help
---

# Nombre del Comando

## Propósito

Qué hace este comando.

## Uso

\`\`\`
/tu-comando [args]
\`\`\`

## Flujo de Trabajo

1. Primer paso
2. Segundo paso
3. Paso final

## Salida

Qué recibe el usuario.
```

---

## MCP y Documentación (por ejemplo, Context7)

Las skills y los agentes pueden usar herramientas **MCP (Model Context Protocol)** para obtener datos actualizados en lugar de depender solo de los datos de entrenamiento. Esto es especialmente útil para documentación.

- **Context7** es un servidor MCP que expone `resolve-library-id` y `query-docs`. Úsalo cuando el usuario pregunte sobre bibliotecas, frameworks o APIs para que las respuestas reflejen la documentación y ejemplos de código actuales.
- Al contribuir **skills** que dependen de documentación en vivo (por ejemplo, configuración, uso de API), describe cómo usar las herramientas MCP relevantes (por ejemplo, resolver el ID de la biblioteca, luego consultar documentos) y apunta a la skill `documentation-lookup` o Context7 como el patrón.
- Al contribuir **agentes** que responden preguntas de documentación/API, incluye los nombres de herramientas MCP de Context7 (por ejemplo, `mcp__context7__resolve-library-id`, `mcp__context7__query-docs`) en las herramientas del agente y documenta el flujo de trabajo resolver → consultar.
- **mcp-configs/mcp-servers.json** incluye una entrada de Context7; los usuarios la habilitan en su harness (por ejemplo, Claude Code, Cursor) para usar la skill de búsqueda de documentación (en `skills/documentation-lookup/`) y el comando `/docs`.

---

## Cross-Harness y Traducciones

### Subconjuntos de Skills (Codex y Cursor)

ECC incluye subconjuntos de skills para otros harnesses:

- **Codex:** `.agents/skills/` — las skills listadas en `agents/openai.yaml` son cargadas por Codex.
- **Cursor:** `.cursor/skills/` — un subconjunto de skills está empaquetado para Cursor.

Cuando **añades una nueva skill** que debería estar disponible en Codex o Cursor:

1. Añade la skill bajo `skills/nombre-de-tu-skill/` como de costumbre.
2. Si debería estar disponible en **Codex**, añádela a `.agents/skills/` (copia el directorio de la skill o añade una referencia) y asegúrate de que esté referenciada en `agents/openai.yaml` si es necesario.
3. Si debería estar disponible en **Cursor**, añádela bajo `.cursor/skills/` según el diseño de Cursor.

Consulta las skills existentes en esos directorios para la estructura esperada. Mantener estos subconjuntos sincronizados es manual; menciona en tu PR si los actualizaste.

### Traducciones

Las traducciones viven bajo `docs/` (por ejemplo, `docs/zh-CN`, `docs/zh-TW`, `docs/ja-JP`). Si cambias agentes, comandos o skills que están traducidos, considera actualizar los archivos de traducción correspondientes o abrir un issue para que los mantenedores o traductores puedan actualizarlos.

---

## Proceso de Pull Request

### 1. Formato del Título del PR

```
feat(skills): add rust-patterns skill
feat(agents): add api-designer agent
feat(hooks): add auto-format hook
fix(skills): update React patterns
docs: improve contributing guide
```

### 2. Descripción del PR

```markdown
## Resumen
Qué estás añadiendo y por qué.

## Tipo
- [ ] Skill
- [ ] Agente
- [ ] Hook
- [ ] Comando

## Pruebas
Cómo lo probaste.

## Lista de Verificación
- [ ] Sigue las directrices de formato
- [ ] Probado con Claude Code
- [ ] Sin información sensible (claves de API, rutas)
- [ ] Descripciones claras
```

### 3. Proceso de Revisión

1. Los mantenedores revisan en 48 horas
2. Atiende el feedback si se solicita
3. Una vez aprobado, se fusiona a main

---

## Directrices

### Haz
- Mantén las contribuciones enfocadas y modulares
- Incluye descripciones claras
- Prueba antes de enviar
- Sigue los patrones existentes
- Documenta las dependencias

### No Hagas
- Incluir datos sensibles (claves de API, tokens, rutas)
- Añadir configuraciones demasiado complejas o de nicho
- Enviar contribuciones sin probar
- Crear duplicados de funcionalidad existente

---

## Nombres de Archivo

- Usa minúsculas con guiones: `python-reviewer.md`
- Sé descriptivo: `tdd-workflow.md` no `workflow.md`
- Haz coincidir el nombre con el nombre del archivo

---

## ¿Preguntas?

- **Issues:** [github.com/affaan-m/everything-claude-code/issues](https://github.com/affaan-m/everything-claude-code/issues)
- **X/Twitter:** [@affaanmustafa](https://x.com/affaanmustafa)

---

¡Gracias por contribuir! Construyamos juntos un gran recurso.
