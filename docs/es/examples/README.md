# Archivos de Configuración de Ejemplo

Este directorio contiene archivos de configuración de ejemplo para Claude Code.

## Archivos

### CLAUDE.md
Ejemplo de archivo de configuración a nivel de proyecto. Coloca este archivo en la raíz de tu proyecto.

**Contenido:**
- Descripción general del proyecto
- Reglas críticas (organización del código, estilo, pruebas, seguridad)
- Estructura de archivos
- Patrones clave
- Variables de entorno
- Comandos disponibles
- Flujo de trabajo con Git

**Ubicación:** `<raíz-del-proyecto>/CLAUDE.md`

### user-CLAUDE.md
Ejemplo de archivo de configuración a nivel de usuario. Esta es tu configuración global que aplica a todos tus proyectos.

**Contenido:**
- Filosofía central y principios
- Reglas modulares
- Agentes disponibles
- Preferencias personales (privacidad, estilo de código, git, pruebas)
- Estrategia de captura de conocimiento
- Integración con editor
- Métricas de éxito

**Ubicación:** `~/.claude/CLAUDE.md`

### statusline.json
Configuración personalizada de la línea de estado. Personaliza la línea de estado que se muestra en la interfaz de terminal de Claude Code.

**Características:**
- Nombre de usuario y directorio de trabajo
- Branch de Git y estado dirty
- Porcentaje de contexto restante
- Nombre del modelo
- Hora
- Contador de tareas

**Ubicación:** Agregar dentro de `~/.claude/settings.json`

## Uso

### Configuración a Nivel de Proyecto
```bash
# Copiar a la raíz de tu proyecto
cp docs/es/examples/CLAUDE.md ./CLAUDE.md
# Editar el contenido según tu proyecto
```

### Configuración a Nivel de Usuario
```bash
# Copiar a tu directorio home
mkdir -p ~/.claude
cp docs/es/examples/user-CLAUDE.md ~/.claude/CLAUDE.md
# Editar según tus preferencias personales
```

### Configuración de Status Line
```bash
# Agregar a tu archivo settings.json
cat docs/es/examples/statusline.json >> ~/.claude/settings.json
```

## Notas

- Los archivos de configuración están en formato Markdown
- Los términos técnicos se mantienen en inglés
- La sintaxis de configuración no cambia
- Solo las descripciones y comentarios están en español

## Recursos Relacionados

- [Documentación Principal](../README.md)
