---
name: instinct-import
description: Importar instintos desde archivo o URL al alcance del proyecto/global
command: true
---

# Comando Instinct Import

## Implementación

Ejecutar la CLI de instintos usando la ruta raíz del plugin:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/scripts/instinct-cli.py" import <archivo-o-url> [--dry-run] [--force] [--min-confidence 0.7] [--scope project|global]
```

O si `CLAUDE_PLUGIN_ROOT` no está configurado (instalación manual):

```bash
python3 ~/.claude/skills/continuous-learning-v2/scripts/instinct-cli.py import <archivo-o-url>
```

Importar instintos desde rutas de archivos locales o URLs HTTP(S).

## Uso

```
/instinct-import team-instincts.yaml
/instinct-import https://github.com/org/repo/instincts.yaml
/instinct-import team-instincts.yaml --dry-run
/instinct-import team-instincts.yaml --scope global --force
```

## Qué Hacer

1. Obtener el archivo de instintos (ruta local o URL)
2. Parsear y validar el formato
3. Verificar duplicados con instintos existentes
4. Fusionar o añadir nuevos instintos
5. Guardar en el directorio de instintos heredados:
   - Alcance de proyecto: `~/.claude/homunculus/projects/<project-id>/instincts/inherited/`
   - Alcance global: `~/.claude/homunculus/instincts/inherited/`

## Proceso de Importación

```
 Importando instintos desde: team-instincts.yaml
================================================

12 instintos encontrados para importar.

Analizando conflictos...

## Nuevos Instintos (8)
Estos se añadirán:
  ✓ use-zod-validation (confianza: 0.7)
  ✓ prefer-named-exports (confianza: 0.65)
  ✓ test-async-functions (confianza: 0.8)
  ...

## Instintos Duplicados (3)
Ya existen instintos similares:
  ADVERTENCIA: prefer-functional-style
     Local: confianza 0.8, 12 observaciones
     Importado: confianza 0.7
     → Conservar local (mayor confianza)

  ADVERTENCIA: test-first-workflow
     Local: confianza 0.75
     Importado: confianza 0.9
     → Actualizar al importado (mayor confianza)

¿Importar 8 nuevos, actualizar 1?
```

## Comportamiento de Fusión

Al importar un instinto con un ID existente:
- El importado con mayor confianza se convierte en candidato de actualización
- El importado con igual/menor confianza se omite
- El usuario confirma a menos que se use `--force`

## Seguimiento de Fuente

Los instintos importados se marcan con:
```yaml
source: inherited
scope: project
imported_from: "team-instincts.yaml"
project_id: "a1b2c3d4e5f6"
project_name: "my-project"
```

## Flags

- `--dry-run`: Vista previa sin importar
- `--force`: Omitir el prompt de confirmación
- `--min-confidence <n>`: Solo importar instintos por encima del umbral
- `--scope <project|global>`: Seleccionar el alcance destino (por defecto: `project`)

## Salida

Después de la importación:
```
¡Importación completada!

Añadidos: 8 instintos
Actualizados: 1 instinto
Omitidos: 3 instintos (ya existe igual/mayor confianza)

Nuevos instintos guardados en: ~/.claude/homunculus/instincts/inherited/

Ejecutar /instinct-status para ver todos los instintos.
```
