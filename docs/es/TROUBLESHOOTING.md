# Guía de Resolución de Problemas

Problemas comunes y soluciones para el plugin Everything Claude Code (ECC).

## Tabla de Contenidos

- [Problemas de Memoria y Contexto](#problemas-de-memoria-y-contexto)
- [Fallos del Harness de Agentes](#fallos-del-harness-de-agentes)
- [Errores de Hooks y Flujos de Trabajo](#errores-de-hooks-y-flujos-de-trabajo)
- [Instalación y Configuración](#instalación-y-configuración)
- [Problemas de Rendimiento](#problemas-de-rendimiento)
- [Mensajes de Error Comunes](#mensajes-de-error-comunes)
- [Obtener Ayuda](#obtener-ayuda)

---

## Problemas de Memoria y Contexto

### Desbordamiento de la Ventana de Contexto

**Síntoma:** Errores de "Context too long" o respuestas incompletas

**Causas:**
- Archivos grandes que superan los límites de tokens
- Historial de conversación acumulado
- Múltiples salidas grandes de herramientas en una sola sesión

**Soluciones:**
```bash
# 1. Borrar el historial de conversación y empezar de nuevo
# Usa Claude Code: "New Chat" o Cmd/Ctrl+Shift+N

# 2. Reducir el tamaño del archivo antes del análisis
head -n 100 large-file.log > sample.log

# 3. Usar streaming para salidas grandes
head -n 50 large-file.txt

# 4. Dividir las tareas en fragmentos más pequeños
# En lugar de: "Analiza los 50 archivos"
# Usa: "Analiza los archivos en el directorio src/components/"
```

### Fallos en la Persistencia de Memoria

**Síntoma:** El agente no recuerda el contexto u observaciones previas

**Causas:**
- Hooks de continuous-learning deshabilitados
- Archivos de observaciones corruptos
- Fallos en la detección del proyecto

**Soluciones:**
```bash
# Verificar si las observaciones se están registrando
ls ~/.claude/homunculus/projects/*/observations.jsonl

# Encontrar el hash id del proyecto actual
python3 - <<'PY'
import json, os
registry_path = os.path.expanduser("~/.claude/homunculus/projects.json")
with open(registry_path) as f:
    registry = json.load(f)
for project_id, meta in registry.items():
    if meta.get("root") == os.getcwd():
        print(project_id)
        break
else:
    raise SystemExit("Hash del proyecto no encontrado en ~/.claude/homunculus/projects.json")
PY

# Ver observaciones recientes para ese proyecto
tail -20 ~/.claude/homunculus/projects/<hash-del-proyecto>/observations.jsonl

# Hacer copia de seguridad de un archivo de observaciones corrupto antes de recrearlo
mv ~/.claude/homunculus/projects/<hash-del-proyecto>/observations.jsonl \
  ~/.claude/homunculus/projects/<hash-del-proyecto>/observations.jsonl.bak.$(date +%Y%m%d-%H%M%S)

# Verificar que los hooks están habilitados
grep -r "observe" ~/.claude/settings.json
```

---

## Fallos del Harness de Agentes

### Agente No Encontrado

**Síntoma:** Errores de "Agent not loaded" o "Unknown agent"

**Causas:**
- Plugin no instalado correctamente
- Configuración incorrecta de la ruta del agente
- Incompatibilidad entre instalación por marketplace y manual

**Soluciones:**
```bash
# Verificar la instalación del plugin
ls ~/.claude/plugins/cache/

# Verificar que el agente existe (instalación por marketplace)
ls ~/.claude/plugins/cache/*/agents/

# Para instalación manual, los agentes deben estar en:
ls ~/.claude/agents/  # Solo agentes personalizados

# Recargar plugin
# Claude Code → Settings → Extensions → Reload
```

### El Flujo de Trabajo se Cuelga

**Síntoma:** El agente empieza pero nunca termina

**Causas:**
- Bucles infinitos en la lógica del agente
- Bloqueado esperando entrada del usuario
- Timeout de red esperando la API

**Soluciones:**
```bash
# 1. Verificar procesos bloqueados
ps aux | grep claude

# 2. Habilitar modo debug
export CLAUDE_DEBUG=1

# 3. Establecer timeouts más cortos
export CLAUDE_TIMEOUT=30

# 4. Verificar conectividad de red
curl -I https://api.anthropic.com
```

### Errores en el Uso de Herramientas

**Síntoma:** "Tool execution failed" o permiso denegado

**Causas:**
- Dependencias faltantes (npm, python, etc.)
- Permisos de archivo insuficientes
- Ruta no encontrada

**Soluciones:**
```bash
# Verificar que las herramientas requeridas están instaladas
which node python3 npm git

# Corregir permisos en los scripts de hook
chmod +x ~/.claude/plugins/cache/*/hooks/*.sh
chmod +x ~/.claude/plugins/cache/*/skills/*/hooks/*.sh

# Verificar que PATH incluye los binarios necesarios
echo $PATH
```

---

## Errores de Hooks y Flujos de Trabajo

### Los Hooks No Se Disparan

**Síntoma:** Los hooks pre/post no se ejecutan

**Causas:**
- Hooks no registrados en settings.json
- Sintaxis de hook inválida
- Script de hook no ejecutable

**Soluciones:**
```bash
# Verificar que los hooks están registrados
grep -A 10 '"hooks"' ~/.claude/settings.json

# Verificar que los archivos de hook existen y son ejecutables
ls -la ~/.claude/plugins/cache/*/hooks/

# Probar el hook manualmente
bash ~/.claude/plugins/cache/*/hooks/pre-bash.sh <<< '{"command":"echo test"}'

# Volver a registrar hooks (si se usa el plugin)
# Deshabilitar y volver a habilitar el plugin en la configuración de Claude Code
```

### Incompatibilidad de Versiones de Python/Node

**Síntoma:** "python3 not found" o "node: command not found"

**Causas:**
- Instalación de Python/Node faltante
- PATH no configurado
- Versión incorrecta de Python (Windows)

**Soluciones:**
```bash
# Instalar Python 3 (si falta)
# macOS: brew install python3
# Ubuntu: sudo apt install python3
# Windows: Descargar de python.org

# Instalar Node.js (si falta)
# macOS: brew install node
# Ubuntu: sudo apt install nodejs npm
# Windows: Descargar de nodejs.org

# Verificar instalaciones
python3 --version
node --version
npm --version

# Windows: Asegurarse de que python (no python3) funciona
python --version
```

### Falsos Positivos del Bloqueador del Servidor de Desarrollo

**Síntoma:** El hook bloquea comandos legítimos que mencionan "dev"

**Causas:**
- Contenido de heredoc disparando la coincidencia de patrón
- Comandos que no son de dev con "dev" en los argumentos

**Soluciones:**
```bash
# Esto está corregido en v1.8.0+ (PR #371)
# Actualiza el plugin a la última versión

# Solución alternativa: Envuelve los servidores de dev en tmux
tmux new-session -d -s dev "npm run dev"
tmux attach -t dev

# Deshabilitar temporalmente el hook si es necesario
# Edita ~/.claude/settings.json y elimina el hook pre-bash
```

---

## Instalación y Configuración

### El Plugin No Carga

**Síntoma:** Funcionalidades del plugin no disponibles después de la instalación

**Causas:**
- Caché del marketplace no actualizado
- Incompatibilidad de versión de Claude Code
- Archivos del plugin corruptos
- Configuración local de Claude eliminada o restablecida

**Soluciones:**
```bash
# Primero inspecciona qué sabe ECC sobre esta máquina
ecc list-installed
ecc doctor
ecc repair

# Solo reinstala si doctor/repair no puede restaurar los archivos faltantes

# Inspecciona la caché del plugin antes de cambiarla
ls -la ~/.claude/plugins/cache/

# Haz una copia de seguridad de la caché del plugin en lugar de eliminarla
mv ~/.claude/plugins/cache ~/.claude/plugins/cache.backup.$(date +%Y%m%d-%H%M%S)
mkdir -p ~/.claude/plugins/cache

# Reinstalar desde el marketplace
# Claude Code → Extensions → Everything Claude Code → Uninstall
# Luego reinstalar desde el marketplace

# Si el problema es el acceso al marketplace/cuenta, usa la recuperación de cuenta/facturación de ECC Tools por separado; no uses la reinstalación como sustituto de la recuperación de cuenta

# Verificar la versión de Claude Code
claude --version
# Requiere Claude Code 2.0+

# Instalación manual (si el marketplace falla)
git clone https://github.com/affaan-m/everything-claude-code.git
cp -r everything-claude-code ~/.claude/plugins/ecc
```

### Falla la Detección del Gestor de Paquetes

**Síntoma:** Se usa el gestor de paquetes incorrecto (npm en lugar de pnpm)

**Causas:**
- No hay archivo de bloqueo presente
- CLAUDE_PACKAGE_MANAGER no está configurado
- Múltiples archivos de bloqueo confunden la detección

**Soluciones:**
```bash
# Configurar el gestor de paquetes preferido globalmente
export CLAUDE_PACKAGE_MANAGER=pnpm
# Añadir a ~/.bashrc o ~/.zshrc

# O configurar por proyecto
echo '{"packageManager": "pnpm"}' > .claude/package-manager.json

# O usar el campo de package.json
npm pkg set packageManager="pnpm@8.15.0"

# Advertencia: eliminar archivos de bloqueo puede cambiar las versiones de dependencias instaladas.
# Haz un commit o copia de seguridad del archivo de bloqueo primero, luego ejecuta una instalación limpia y vuelve a ejecutar CI.
# Solo hazlo cuando cambies intencionalmente de gestor de paquetes.
rm package-lock.json  # Si usas pnpm/yarn/bun
```

---

## Problemas de Rendimiento

### Tiempos de Respuesta Lentos

**Síntoma:** El agente tarda más de 30 segundos en responder

**Causas:**
- Archivos de observaciones grandes
- Demasiados hooks activos
- Latencia de red a la API

**Soluciones:**
```bash
# Archivar observaciones grandes en lugar de eliminarlas
archive_dir="$HOME/.claude/homunculus/archive/$(date +%Y%m%d)"
mkdir -p "$archive_dir"
find ~/.claude/homunculus/projects -name "observations.jsonl" -size +10M -exec sh -c '
  for file do
    base=$(basename "$(dirname "$file")")
    gzip -c "$file" > "'"$archive_dir"'/${base}-observations.jsonl.gz"
    : > "$file"
  done
' sh {} +

# Deshabilitar hooks no utilizados temporalmente
# Edita ~/.claude/settings.json

# Mantener pequeños los archivos de observaciones activos
# Los archivos de gran tamaño deben estar bajo ~/.claude/homunculus/archive/
```

### Alto Uso de CPU

**Síntoma:** Claude Code consume 100% de CPU

**Causas:**
- Bucles de observación infinitos
- Observación de archivos en directorios grandes
- Fugas de memoria en hooks

**Soluciones:**
```bash
# Verificar procesos desbocados
top -o cpu | grep claude

# Deshabilitar el aprendizaje continuo temporalmente
touch ~/.claude/homunculus/disabled

# Reiniciar Claude Code
# Cmd/Ctrl+Q luego volver a abrir

# Verificar el tamaño del archivo de observaciones
du -sh ~/.claude/homunculus/*/
```

---

## Mensajes de Error Comunes

### "EACCES: permission denied"

```bash
# Corregir permisos de hooks
find ~/.claude/plugins -name "*.sh" -exec chmod +x {} \;

# Corregir permisos del directorio de observaciones
chmod -R u+rwX,go+rX ~/.claude/homunculus
```

### "MODULE_NOT_FOUND"

```bash
# Instalar dependencias del plugin
cd ~/.claude/plugins/cache/ecc
npm install

# O para instalación manual
cd ~/.claude/plugins/ecc
npm install
```

### "spawn UNKNOWN"

```bash
# Específico de Windows: Asegúrate de que los scripts usen los finales de línea correctos
# Convertir CRLF a LF
find ~/.claude/plugins -name "*.sh" -exec dos2unix {} \;

# O instalar dos2unix
# macOS: brew install dos2unix
# Ubuntu: sudo apt install dos2unix
```

---

## Obtener Ayuda

Si sigues experimentando problemas:

1. **Revisa los Issues de GitHub**: [github.com/affaan-m/everything-claude-code/issues](https://github.com/affaan-m/everything-claude-code/issues)
2. **Habilita el Registro de Depuración**:
   ```bash
   export CLAUDE_DEBUG=1
   export CLAUDE_LOG_LEVEL=debug
   ```
3. **Recopila Información de Diagnóstico**:
   ```bash
   claude --version
   node --version
   python3 --version
   echo $CLAUDE_PACKAGE_MANAGER
   ls -la ~/.claude/plugins/cache/
   ```
4. **Abre un Issue**: Incluye registros de depuración, mensajes de error e información de diagnóstico

---

## Documentación Relacionada

- [README.md](README.md) - Instalación y funcionalidades
- [CONTRIBUTING.md](CONTRIBUTING.md) - Directrices de desarrollo
- [docs/](../../docs/) - Documentación detallada
- [examples/](examples/) - Ejemplos de uso
