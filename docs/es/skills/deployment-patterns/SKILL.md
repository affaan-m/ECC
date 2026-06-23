---
name: deployment-patterns
description: Flujos de trabajo de despliegue, patrones de pipeline CI/CD, contenedorización Docker, health checks, estrategias de rollback y listas de verificación de preparación para producción de aplicaciones web.
origin: ECC
---

# Patrones de Despliegue

Flujos de trabajo de despliegue en producción y buenas prácticas de CI/CD.

## Cuándo Activar

- Configurar pipelines de CI/CD
- Contenedorizar una aplicación con Docker
- Planificar estrategia de despliegue (blue-green, canary, rolling)
- Implementar health checks y readiness probes
- Preparar un lanzamiento a producción
- Configurar ajustes específicos por entorno

## Estrategias de Despliegue

### Rolling Deployment (Por Defecto)

Reemplazar instancias gradualmente — las versiones vieja y nueva se ejecutan simultáneamente durante el despliegue.

```
Instancia 1: v1 → v2  (actualizar primero)
Instancia 2: v1        (aún ejecutando v1)
Instancia 3: v1        (aún ejecutando v1)

Instancia 1: v2
Instancia 2: v1 → v2  (actualizar segundo)
Instancia 3: v1

Instancia 1: v2
Instancia 2: v2
Instancia 3: v1 → v2  (actualizar último)
```

**Pros:** Zero downtime, despliegue gradual
**Contras:** Dos versiones se ejecutan simultáneamente — requiere cambios compatibles hacia atrás
**Usar cuando:** Despliegues estándar, cambios compatibles hacia atrás

### Blue-Green Deployment

Ejecutar dos entornos idénticos. Cambiar el tráfico de forma atómica.

```
Blue  (v1) ← tráfico
Green (v2)   inactivo, ejecutando nueva versión

# Después de la verificación:
Blue  (v1)   inactivo (se convierte en standby)
Green (v2) ← tráfico
```

**Pros:** Rollback instantáneo (cambiar de vuelta a blue), corte limpio
**Contras:** Requiere 2x infraestructura durante el despliegue
**Usar cuando:** Servicios críticos, tolerancia cero a problemas

### Canary Deployment

Enrutar un pequeño porcentaje del tráfico a la nueva versión primero.

```
v1: 95% del tráfico
v2:  5% del tráfico  (canary)

# Si las métricas se ven bien:
v1: 50% del tráfico
v2: 50% del tráfico

# Final:
v2: 100% del tráfico
```

**Pros:** Detecta problemas con tráfico real antes del despliegue completo
**Contras:** Requiere infraestructura de división de tráfico, monitoreo
**Usar cuando:** Servicios de alto tráfico, cambios arriesgados, feature flags

## Docker

### Dockerfile Multi-Stage (Node.js)

```dockerfile
# Etapa 1: Instalar dependencias
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Etapa 2: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm prune --production

# Etapa 3: Imagen de producción
FROM node:22-alpine AS runner
WORKDIR /app

RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001
USER appuser

COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/package.json ./

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
```

### Dockerfile Multi-Stage (Go)

```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /server ./cmd/server

FROM alpine:3.19 AS runner
RUN apk --no-cache add ca-certificates
RUN adduser -D -u 1001 appuser
USER appuser

COPY --from=builder /server /server

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/health || exit 1
CMD ["/server"]
```

### Dockerfile Multi-Stage (Python/Django)

```dockerfile
FROM python:3.12-slim AS builder
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY requirements.txt .
RUN uv pip install --system --no-cache -r requirements.txt

FROM python:3.12-slim AS runner
WORKDIR /app

RUN useradd -r -u 1001 appuser
USER appuser

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY . .

ENV PYTHONUNBUFFERED=1
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health/')" || exit 1
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "4"]
```

### Buenas Prácticas de Docker

```
# Buenas prácticas
- Usar etiquetas de versión específicas (node:22-alpine, no node:latest)
- Builds multi-stage para minimizar el tamaño de imagen
- Ejecutar como usuario no-root
- Copiar archivos de dependencias primero (cache de capas)
- Usar .dockerignore para excluir node_modules, .git, tests
- Agregar instrucción HEALTHCHECK
- Establecer límites de recursos en docker-compose o k8s

# Malas prácticas
- Ejecutar como root
- Usar etiquetas :latest
- Copiar todo el repositorio en una sola capa COPY
- Instalar dependencias de desarrollo en imagen de producción
- Almacenar secretos en la imagen (usar variables de entorno o gestor de secretos)
```

## Pipeline CI/CD

### GitHub Actions (Pipeline Estándar)

```yaml
name: CI/CD

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test -- --coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage
          path: coverage/

  build:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment: production
    steps:
      - name: Deploy to production
        run: |
          # Comando de despliegue específico de plataforma
          # Railway: railway up
          # Vercel: vercel --prod
          # K8s: kubectl set image deployment/app app=ghcr.io/${{ github.repository }}:${{ github.sha }}
          echo "Deploying ${{ github.sha }}"
```

### Etapas del Pipeline

```
PR abierto:
  lint → typecheck → pruebas unitarias → pruebas de integración → despliegue preview

Merge a main:
  lint → typecheck → pruebas unitarias → pruebas de integración → build imagen → desplegar staging → smoke tests → desplegar producción
```

## Health Checks

### Endpoint de Health Check

```typescript
// Health check simple
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Health check detallado (para monitoreo interno)
app.get("/health/detailed", async (req, res) => {
  const checks = {
    database: await checkDatabase(),
    redis: await checkRedis(),
    externalApi: await checkExternalApi(),
  };

  const allHealthy = Object.values(checks).every(c => c.status === "ok");

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || "unknown",
    uptime: process.uptime(),
    checks,
  });
});

async function checkDatabase(): Promise<HealthCheck> {
  try {
    await db.query("SELECT 1");
    return { status: "ok", latency_ms: 2 };
  } catch (err) {
    return { status: "error", message: "Database unreachable" };
  }
}
```

### Probes de Kubernetes

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 30
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
  failureThreshold: 2

startupProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 0
  periodSeconds: 5
  failureThreshold: 30    # 30 * 5s = 150s tiempo máximo de inicio
```

## Configuración de Entorno

### Patrón Twelve-Factor App

```bash
# Toda la configuración mediante variables de entorno — nunca en el código
DATABASE_URL=postgres://user:pass@host:5432/db
REDIS_URL=redis://host:6379/0
API_KEY=${API_KEY}           # inyectado por el gestor de secretos
LOG_LEVEL=info
PORT=3000

# Comportamiento específico por entorno
NODE_ENV=production          # o staging, development
APP_ENV=production           # entorno de app explícito
```

### Validación de Configuración

```typescript
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "staging", "production"]),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

// Validar al inicio — fallar rápido si la configuración es incorrecta
export const env = envSchema.parse(process.env);
```

## Estrategia de Rollback

### Rollback Instantáneo

```bash
# Docker/Kubernetes: apuntar a imagen anterior
kubectl rollout undo deployment/app

# Vercel: promover despliegue anterior
vercel rollback

# Railway: volver a desplegar commit anterior
railway up --commit <previous-sha>

# Base de datos: revertir migración (si es reversible)
npx prisma migrate resolve --rolled-back <migration-name>
```

### Lista de Verificación de Rollback

- [ ] La imagen/artefacto anterior está disponible y etiquetado
- [ ] Las migraciones de base de datos son compatibles hacia atrás (sin cambios destructivos)
- [ ] Los feature flags pueden deshabilitar nuevas funciones sin despliegue
- [ ] Alertas de monitoreo configuradas para picos de tasa de error
- [ ] Rollback probado en staging antes del lanzamiento a producción

## Lista de Verificación de Preparación para Producción

Antes de cualquier despliegue a producción:

### Aplicación
- [ ] Todas las pruebas pasan (unitarias, integración, E2E)
- [ ] Sin secretos hardcodeados en código o archivos de configuración
- [ ] El manejo de errores cubre todos los casos límite
- [ ] El logging es estructurado (JSON) y no contiene PII
- [ ] El endpoint de health check retorna estado significativo

### Infraestructura
- [ ] La imagen Docker se construye de forma reproducible (versiones fijadas)
- [ ] Las variables de entorno están documentadas y validadas al inicio
- [ ] Límites de recursos establecidos (CPU, memoria)
- [ ] Escalado horizontal configurado (instancias mín/máx)
- [ ] SSL/TLS habilitado en todos los endpoints

### Monitoreo
- [ ] Métricas de aplicación exportadas (tasa de requests, latencia, errores)
- [ ] Alertas configuradas para tasa de error > umbral
- [ ] Agregación de logs configurada (logs estructurados, con búsqueda)
- [ ] Monitoreo de uptime en endpoint de health

### Seguridad
- [ ] Dependencias escaneadas en busca de CVEs
- [ ] CORS configurado solo para orígenes permitidos
- [ ] Rate limiting habilitado en endpoints públicos
- [ ] Autenticación y autorización verificadas
- [ ] Headers de seguridad establecidos (CSP, HSTS, X-Frame-Options)

### Operaciones
- [ ] Plan de rollback documentado y probado
- [ ] Migración de base de datos probada contra datos de tamaño de producción
- [ ] Runbook para escenarios de fallo comunes
- [ ] Rotación de on-call y ruta de escalación definida
