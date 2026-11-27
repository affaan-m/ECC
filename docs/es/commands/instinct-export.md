---
name: instinct-export
description: Exportar instintos del alcance del proyecto/global a un archivo
command: /instinct-export
---

# Comando Instinct Export

Exporta los instintos a un formato compartible. Perfecto para:
- Compartir con compañeros de equipo
- Transferir a una nueva máquina
- Contribuir a las convenciones del proyecto

## Uso

```
/instinct-export                           # Exportar todos los instintos personales
/instinct-export --domain testing          # Exportar solo instintos de testing
/instinct-export --min-confidence 0.7      # Solo exportar instintos de alta confianza
/instinct-export --output team-instincts.yaml
/instinct-export --scope project --output project-instincts.yaml
```

## Qué Hacer

1. Detectar el contexto actual del proyecto
2. Cargar instintos por alcance seleccionado:
   - `project`: solo el proyecto actual
   - `global`: solo global
   - `all`: proyecto + global fusionados (por defecto)
3. Aplicar filtros (`--domain`, `--min-confidence`)
4. Escribir la exportación en formato YAML al archivo (o stdout si no se proporciona ruta de salida)

## Formato de Salida

Crea un archivo YAML:

```yaml
# Exportación de Instintos
# Generado: 2025-01-22
# Fuente: personal
# Cantidad: 12 instintos

---
id: prefer-functional-style
trigger: "when writing new functions"
confidence: 0.8
domain: code-style
source: session-observation
scope: project
project_id: a1b2c3d4e5f6
project_name: my-app
---

# Preferir Estilo Funcional

## Acción
Usar patrones funcionales sobre clases.
```

## Flags

- `--domain <nombre>`: Exportar solo el dominio especificado
- `--min-confidence <n>`: Umbral mínimo de confianza
- `--output <archivo>`: Ruta del archivo de salida (imprime a stdout si se omite)
- `--scope <project|global|all>`: Alcance de exportación (por defecto: `all`)
