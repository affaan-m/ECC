---
description: Analizar un proyecto y generar comandos de servicio PM2 para los servicios detectados de frontend, backend o base de datos.
---

# PM2 Init

Auto-analizar el proyecto y generar comandos de servicio PM2.

**Comando**: `$ARGUMENTS`

---

## Flujo de Trabajo

1. Verificar PM2 (instalar mediante `npm install -g pm2` si falta)
2. Escanear el proyecto para identificar servicios (frontend/backend/base de datos)
3. Generar archivos de configuración y archivos de comando individuales

---

## Detección de Servicios

| Tipo | Detección | Puerto por Defecto |
|------|-----------|-------------------|
| Vite | vite.config.* | 5173 |
| Next.js | next.config.* | 3000 |
| Nuxt | nuxt.config.* | 3000 |
| CRA | react-scripts en package.json | 3000 |
| Express/Node | directorio server/backend/api + package.json | 3000 |
| FastAPI/Flask | requirements.txt / pyproject.toml | 8000 |
| Go | go.mod / main.go | 8080 |

**Prioridad de Detección de Puerto**: Usuario especificado > .env > archivo de config > args de scripts > puerto por defecto

---

## Archivos Generados

```
project/
├── ecosystem.config.cjs              # Configuración PM2
├── {backend}/start.cjs               # Wrapper Python (si aplica)
└── .claude/
    ├── commands/
    │   ├── pm2-all.md                # Iniciar todo + monit
    │   ├── pm2-all-stop.md           # Detener todo
    │   ├── pm2-all-restart.md        # Reiniciar todo
    │   ├── pm2-{puerto}.md           # Iniciar único + logs
    │   ├── pm2-{puerto}-stop.md      # Detener único
    │   ├── pm2-{puerto}-restart.md   # Reiniciar único
    │   ├── pm2-logs.md               # Ver todos los logs
    │   └── pm2-status.md             # Ver estado
    └── scripts/
        ├── pm2-logs-{puerto}.ps1     # Logs de servicio único
        └── pm2-monit.ps1             # Monitor PM2
```

---

## Configuración Windows (IMPORTANTE)

### ecosystem.config.cjs

**Debe usar extensión `.cjs`**

```javascript
module.exports = {
  apps: [
    // Node.js (Vite/Next/Nuxt)
    {
      name: 'project-3000',
      cwd: './packages/web',
      script: 'node_modules/vite/bin/vite.js',
      args: '--port 3000',
      interpreter: 'C:/Program Files/nodejs/node.exe',
      env: { NODE_ENV: 'development' }
    }
  ]
}
```

---

## Reglas Clave

1. **Archivo de config**: `ecosystem.config.cjs` (no .js)
2. **Node.js**: Especificar ruta del bin directamente + intérprete
3. **Python**: Script wrapper Node.js + `windowsHide: true`
4. **Abrir nueva ventana**: `start wt.exe -d "{ruta}" pwsh -NoExit -c "comando"`
5. **Contenido mínimo**: Cada archivo de comando tiene solo 1-2 líneas de descripción + bloque bash
6. **Ejecución directa**: Sin necesidad de parseo por IA, solo ejecutar el comando bash

---

## Resumen Post-Init

Después de generar todos los archivos:

```
## PM2 Init Completado

**Servicios:**

| Puerto | Nombre | Tipo |
|--------|--------|------|
| {puerto} | {nombre} | {tipo} |

**Comandos Claude:** /pm2-all, /pm2-all-stop, /pm2-{puerto}, /pm2-{puerto}-stop, /pm2-logs, /pm2-status

**Comandos de Terminal:**
pm2 start ecosystem.config.cjs   # Primera vez
pm2 start all                    # Después de la primera vez
pm2 stop all / pm2 restart all
pm2 logs / pm2 status / pm2 monit
pm2 resurrect                    # Restaurar lista guardada
```
