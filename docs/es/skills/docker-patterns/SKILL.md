---
name: docker-patterns
description: Patrones de Docker y Docker Compose para desarrollo local, seguridad de contenedores, networking, estrategias de volúmenes y orquestación de múltiples servicios.
origin: ECC
---

# Patrones Docker

Buenas prácticas de Docker y Docker Compose para desarrollo en contenedores.

## Cuándo Activar

- Configurar Docker Compose para desarrollo local
- Diseñar arquitecturas de múltiples contenedores
- Resolver problemas de networking o volúmenes de contenedores
- Revisar Dockerfiles para seguridad y tamaño
- Migrar de desarrollo local a flujo de trabajo en contenedores

## Docker Compose para Desarrollo Local

### Stack Estándar de Aplicación Web

```yaml
# docker-compose.yml
services:
  app:
    build:
      context: .
      target: dev                     # Usar etapa dev del Dockerfile multi-stage
    ports:
      - "3000:3000"
    volumes:
      - .:/app                        # Bind mount para hot reload
      - /app/node_modules             # Volumen anónimo -- preserva deps del contenedor
    environment:
      - DATABASE_URL=postgres://postgres:postgres@db:5432/app_dev
      - REDIS_URL=redis://redis:6379/0
      - NODE_ENV=development
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    command: npm run dev

  db:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: app_dev
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data

  mailpit:                            # Pruebas de email locales
    image: axllent/mailpit
    ports:
      - "8025:8025"                   # Web UI
      - "1025:1025"                   # SMTP

volumes:
  pgdata:
  redisdata:
```

### Dockerfile de Desarrollo vs Producción

```dockerfile
# Etapa: dependencias
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Etapa: dev (hot reload, herramientas de debug)
FROM node:22-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Etapa: build
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --production

# Etapa: producción (imagen mínima)
FROM node:22-alpine AS production
WORKDIR /app
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001
USER appuser
COPY --from=build --chown=appuser:appgroup /app/dist ./dist
COPY --from=build --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build --chown=appuser:appgroup /app/package.json ./
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/server.js"]
```

### Archivos de Override

```yaml
# docker-compose.override.yml (carga automática, configuración solo para dev)
services:
  app:
    environment:
      - DEBUG=app:*
      - LOG_LEVEL=debug
    ports:
      - "9229:9229"                   # Debugger de Node.js

# docker-compose.prod.yml (explícito para producción)
services:
  app:
    build:
      target: production
    restart: always
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
```

```bash
# Desarrollo (carga override automáticamente)
docker compose up

# Producción
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Networking

### Descubrimiento de Servicios

Los servicios en la misma red de Compose se resuelven por nombre de servicio:
```
# Desde el contenedor "app":
postgres://postgres:postgres@db:5432/app_dev    # "db" resuelve al contenedor db
redis://redis:6379/0                             # "redis" resuelve al contenedor redis
```

### Redes Personalizadas

```yaml
services:
  frontend:
    networks:
      - frontend-net

  api:
    networks:
      - frontend-net
      - backend-net

  db:
    networks:
      - backend-net              # Solo accesible desde api, no desde frontend

networks:
  frontend-net:
  backend-net:
```

### Exponer Solo Lo Necesario

```yaml
services:
  db:
    ports:
      - "127.0.0.1:5432:5432"   # Solo accesible desde el host, no desde la red
    # Omitir ports completamente en producción -- accesible solo dentro de la red Docker
```

## Estrategias de Volúmenes

```yaml
volumes:
  # Volumen nombrado: persiste entre reinicios de contenedor, gestionado por Docker
  pgdata:

  # Bind mount: mapea directorio del host al contenedor (para desarrollo)
  # - ./src:/app/src

  # Volumen anónimo: preserva contenido generado por el contenedor del bind mount override
  # - /app/node_modules
```

### Patrones Comunes

```yaml
services:
  app:
    volumes:
      - .:/app                   # Código fuente (bind mount para hot reload)
      - /app/node_modules        # Proteger node_modules del contenedor del host
      - /app/.next               # Proteger caché de build

  db:
    volumes:
      - pgdata:/var/lib/postgresql/data          # Datos persistentes
      - ./scripts/init.sql:/docker-entrypoint-initdb.d/init.sql  # Scripts de init
```

## Seguridad de Contenedores

### Hardening de Dockerfile

```dockerfile
# 1. Usar etiquetas específicas (nunca :latest)
FROM node:22.12-alpine3.20

# 2. Ejecutar como usuario no-root
RUN addgroup -g 1001 -S app && adduser -S app -u 1001
USER app

# 3. Eliminar capabilities (en compose)
# 4. Sistema de archivos raíz de solo lectura donde sea posible
# 5. Sin secretos en capas de imagen
```

### Seguridad de Compose

```yaml
services:
  app:
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp
      - /app/.cache
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE          # Solo si se vincula a puertos < 1024
```

### Gestión de Secretos

```yaml
# BIEN: Usar variables de entorno (inyectadas en tiempo de ejecución)
services:
  app:
    env_file:
      - .env                     # Nunca hacer commit de .env a git
    environment:
      - API_KEY                  # Hereda del entorno del host

# BIEN: Docker secrets (modo Swarm)
secrets:
  db_password:
    file: ./secrets/db_password.txt

services:
  db:
    secrets:
      - db_password

# MAL: Hardcodeado en imagen
# ENV API_KEY=sk-proj-xxxxx      # NUNCA HACER ESTO
```

## .dockerignore

```
node_modules
.git
.env
.env.*
dist
coverage
*.log
.next
.cache
docker-compose*.yml
Dockerfile*
README.md
tests/
```

## Depuración

### Comandos Comunes

```bash
# Ver logs
docker compose logs -f app           # Seguir logs de app
docker compose logs --tail=50 db     # Últimas 50 líneas de db

# Ejecutar comandos en contenedor en ejecución
docker compose exec app sh           # Shell en app
docker compose exec db psql -U postgres  # Conectar a postgres

# Inspeccionar
docker compose ps                     # Servicios en ejecución
docker compose top                    # Procesos en cada contenedor
docker stats                          # Uso de recursos

# Reconstruir
docker compose up --build             # Reconstruir imágenes
docker compose build --no-cache app   # Forzar reconstrucción completa

# Limpiar
docker compose down                   # Detener y eliminar contenedores
docker compose down -v                # También eliminar volúmenes (DESTRUCTIVO)
docker system prune                   # Eliminar imágenes/contenedores no usados
```

### Depurar Problemas de Red

```bash
# Verificar resolución DNS dentro del contenedor
docker compose exec app nslookup db

# Verificar conectividad
docker compose exec app wget -qO- http://api:3000/health

# Inspeccionar red
docker network ls
docker network inspect <project>_default
```

## Anti-Patrones

```
# MAL: Usar docker compose en producción sin orquestación
# Usar Kubernetes, ECS o Docker Swarm para cargas de trabajo de múltiples contenedores en producción

# MAL: Almacenar datos en contenedores sin volúmenes
# Los contenedores son efímeros -- todos los datos se pierden al reiniciar sin volúmenes

# MAL: Ejecutar como root
# Siempre crear y usar un usuario no-root

# MAL: Usar etiqueta :latest
# Fijar a versiones específicas para builds reproducibles

# MAL: Un contenedor gigante con todos los servicios
# Separar responsabilidades: un proceso por contenedor

# MAL: Poner secretos en docker-compose.yml
# Usar archivos .env (en .gitignore) o Docker secrets
```
