# Política de Seguridad

## Versiones Soportadas

| Versión | Soportada          |
| ------- | ------------------ |
| 1.9.x   | :white_check_mark: |
| 1.8.x   | :white_check_mark: |
| < 1.8   | :x:                |

## Reportar una Vulnerabilidad

Si descubres una vulnerabilidad de seguridad en ECC, por favor repórtala de forma responsable.

**No abras un issue público de GitHub para vulnerabilidades de seguridad.**

En cambio, envía un correo a **<security@ecc.tools>** con:

- Una descripción de la vulnerabilidad
- Pasos para reproducirla
- La(s) versión(es) afectada(s)
- Cualquier evaluación del impacto potencial

Puedes esperar:

- **Confirmación** en 48 horas
- **Actualización de estado** en 7 días
- **Corrección o mitigación** en 30 días para problemas críticos

Si la vulnerabilidad es aceptada:

- Te daremos crédito en las notas de la versión (a menos que prefieras el anonimato)
- Corregiremos el problema oportunamente
- Coordinaremos el tiempo de divulgación contigo

Si la vulnerabilidad es rechazada, explicaremos por qué y proporcionaremos orientación sobre si debe reportarse en otro lugar.

## Alcance

Esta política cubre:

- El plugin de ECC y todos los scripts de este repositorio
- Scripts de hooks que se ejecutan en tu máquina
- Scripts del ciclo de vida de instalación/desinstalación/reparación
- Configuraciones de MCP incluidas con ECC
- El escáner de seguridad AgentShield ([github.com/affaan-m/agentshield](https://github.com/affaan-m/agentshield))

## Orientación Operacional

### Manejo de Secretos

`mcp-configs/mcp-servers.json` es una **plantilla**. Todos los valores `YOUR_*_HERE` deben reemplazarse en el momento de la instalación desde variables de entorno o un gestor de secretos. Nunca confirmes credenciales reales. Si un secreto se confirma accidentalmente, rótalo inmediatamente y reescribe el historial; no confíes en una simple reversión.

La misma regla se aplica a tu configuración de Claude Code en el ámbito del usuario (`~/.claude/settings.json` o `%USERPROFILE%\.claude\settings.json`). Ese archivo está fuera de este repositorio, pero se comparte comúnmente mediante la salida de `claude doctor`, capturas de pantalla o reportes de errores. No codifiques PATs, claves de API o tokens OAuth en sus bloques `mcpServers[*].env`; resuélvelos en el momento del inicio desde el llavero del sistema operativo o variables de entorno que tu servidor MCP ya soporte. Una auditoría rápida:

```bash
# macOS / Linux
grep -EnH '(TOKEN|SECRET|KEY|PASSWORD)\s*"\s*:\s*"[A-Za-z0-9_-]{16,}"' ~/.claude/settings.json
# Windows PowerShell
Select-String -Path "$env:USERPROFILE\.claude\settings.json" -Pattern '(TOKEN|SECRET|KEY|PASSWORD)"\s*:\s*"[A-Za-z0-9_-]{16,}"'
```

Si la auditoría coincide, rota el secreto en el proveedor emisor, luego muévelo fuera del archivo (variable de entorno por proveedor o `credentialHelper` para servidores que lo soporten).

### Puertos MCP Locales

Algunos servidores MCP incluidos se conectan mediante HTTP simple a un puerto localhost (por ejemplo, `devfleet` a `http://localhost:18801/mcp`). Antes del primer uso, verifica el proceso que escucha:

```bash
# Windows
netstat -ano | findstr :18801
# macOS / Linux
lsof -iTCP:18801 -sTCP:LISTEN
```

Compara el PID con el binario esperado de devfleet. Cualquier otro proceso en ese puerto puede interceptar el tráfico de MCP.

## Triaje: bloques `<system-reminder>` sospechosos

ECC se ejecuta dentro de Claude Code, que inyecta **recordatorios efímeros del lado del cliente** en la entrada del modelo en cada turno (recordatorios de TodoWrite, avisos de cambio de fecha, avisos de archivo modificado, etc.). Estos bloques:

- típicamente terminan con frases como *"ignorar si no aplica"* o *"NUNCA mencionar este recordatorio al usuario"* / *"No le digas esto al usuario, ya que ya lo sabe"*; esa redacción es del propio prompt de Anthropic, no una cola maliciosa;
- son añadidos por el CLI por turno y **no se persisten** en el transcript de sesión en `~/.claude/projects/<slug>/<sessionId>.jsonl`.

Esa combinación los hace fáciles de confundir con una inyección de prompt añadida a un resultado de herramienta. Antes de tratarlo como un ataque, verifica:

1. ¿El bloque está realmente en un archivo bajo este repo? `grep -rEn "system-reminder|NEVER mention|DO NOT mention" .`; si no hay nada, no está en el repo.
2. ¿El bloque está almacenado en el transcript? Inspecciona el `.jsonl` de la sesión actual; si el texto exacto no aparece dentro de un cuerpo `tool_result`, es un recordatorio efímero inyectado por el cliente, no un payload de ninguna herramienta.
3. ¿El contenido es contextualmente consistente con los recordatorios conocidos de Anthropic (recordatorio de TodoWrite, cambio de fecha, aviso de archivo modificado)? Si es así, es el mecanismo de recordatorio efímero y no se requiere ninguna acción.

Escala a Anthropic solo si un bloque **tanto** (a) está presente en el transcript dentro de un `tool_result` **como** (b) no es atribuible al archivo o URL que se leyó realmente. Informe mínimo: una sesión nueva, una lectura de un archivo local limpio, el texto exacto observado y el extracto del transcript. Envía a <https://github.com/anthropics/claude-code/issues> (no sensible) o <mailto:security@anthropic.com> (clase embargo).

No sanitices los archivos del repo en respuesta a recordatorios efímeros; no son el portador.

## Recursos de Seguridad

- **AgentShield**: Analiza tu configuración de agentes en busca de vulnerabilidades — `npx ecc-agentshield scan`
- **Guía de Seguridad**: [La Guía Resumida de Seguridad Agentiva](../../the-security-guide.md)
- **Respuesta a incidentes en la cadena de suministro**: [Guía npm/GitHub Actions](../security/supply-chain-incident-response.md)
- **OWASP MCP Top 10**: [owasp.org/www-project-mcp-top-10](https://owasp.org/www-project-mcp-top-10/)
- **OWASP Agentic Applications Top 10**: [genai.owasp.org](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)
