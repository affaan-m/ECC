---
name: docker-patterns
description: Docker and Docker Compose patterns for local development, hardened CLI installer harnesses, container security, networking, volumes, and multi-service orchestration. Use when creating or reviewing Dockerfiles and Compose services, testing installers across Linux distributions, or planning accurate native macOS and Windows validation.
---

# Docker Patterns

Docker and Docker Compose best practices for containerized development.

## Docker Compose for Local Development

### Standard Web App Stack

```yaml
# docker-compose.yml
services:
  app:
    build:
      context: .
      target: dev                     # Use dev stage of multi-stage Dockerfile
    ports:
      - "3000:3000"
    volumes:
      - .:/app                        # Bind mount for hot reload
      - /app/node_modules             # Anonymous volume -- preserves container deps
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

  mailpit:                            # Local email testing
    image: axllent/mailpit
    ports:
      - "8025:8025"                   # Web UI
      - "1025:1025"                   # SMTP

volumes:
  pgdata:
  redisdata:
```

### Development vs Production Dockerfile

```dockerfile
# Stage: dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage: dev (hot reload, debug tools)
FROM node:22-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Stage: build
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --production

# Stage: production (minimal image)
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

### Override Files

```yaml
# docker-compose.override.yml (auto-loaded, dev-only settings)
services:
  app:
    environment:
      - DEBUG=app:*
      - LOG_LEVEL=debug
    ports:
      - "9229:9229"                   # Node.js debugger

# docker-compose.prod.yml (explicit for production)
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
# Development (auto-loads override)
docker compose up

# Production
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Networking

### Service Discovery

Services in the same Compose network resolve by service name:
```
# From "app" container:
postgres://postgres:postgres@db:5432/app_dev    # "db" resolves to the db container
redis://redis:6379/0                             # "redis" resolves to the redis container
```

### Custom Networks

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
      - backend-net              # Only reachable from api, not frontend

networks:
  frontend-net:
  backend-net:
```

### Exposing Only What's Needed

```yaml
services:
  db:
    ports:
      - "127.0.0.1:5432:5432"   # Only accessible from host, not network
    # Omit ports entirely in production -- accessible only within Docker network
```

## Volume Strategies

```yaml
volumes:
  # Named volume: persists across container restarts, managed by Docker
  pgdata:

  # Bind mount: maps host directory into container (for development)
  # - ./src:/app/src

  # Anonymous volume: preserves container-generated content from bind mount override
  # - /app/node_modules
```

### Common Patterns

```yaml
services:
  app:
    volumes:
      - .:/app                   # Source code (bind mount for hot reload)
      - /app/node_modules        # Protect container's node_modules from host
      - /app/.next               # Protect build cache

  db:
    volumes:
      - pgdata:/var/lib/postgresql/data          # Persistent data
      - ./scripts/init.sql:/docker-entrypoint-initdb.d/init.sql  # Init scripts
```

## Container Security

### Dockerfile Hardening

```dockerfile
# 1. Use specific tags (never :latest)
FROM node:22.12-alpine3.20

# 2. Run as non-root
RUN addgroup -g 1001 -S app && adduser -S app -u 1001
USER app

# 3. Drop capabilities (in compose)
# 4. Read-only root filesystem where possible
# 5. No secrets in image layers
```

### Compose Security

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
      - NET_BIND_SERVICE          # Only if binding to ports < 1024
```

### Secret Management

```yaml
# GOOD: Use environment variables (injected at runtime)
services:
  app:
    env_file:
      - .env                     # Never commit .env to git
    environment:
      - API_KEY                  # Inherits from host environment

# GOOD: Docker secrets (Swarm mode)
secrets:
  db_password:
    file: ./secrets/db_password.txt

services:
  db:
    secrets:
      - db_password

# BAD: Hardcoded in image
# ENV API_KEY=sk-proj-xxxxx      # NEVER DO THIS
```

## Hardened CLI Installer Harnesses

Use containers to test installer behavior against disposable project copies without allowing the test to mutate the source checkout.

### Respect the Platform Boundary

- Run real containers for Linux distributions such as Debian and Ubuntu.
- macOS cannot run as a Docker container because Docker shares a Linux kernel. Run the same shell-free test entry point natively on macOS.
- Windows containers require a Windows Docker engine. Run platform-independent logic on a native Windows CI runner and reserve Windows containers for a Windows host.
- Keep a native Ubuntu/macOS/Windows CI matrix for host-specific paths, command shims, quoting, and filesystem behavior.

Do not claim that a Linux container validates macOS or Windows behavior.

### Enforce the Isolation Contract

- Pin base images by immutable digest and pin installed CLI versions.
- Run as a non-root numeric UID/GID when distro account names differ.
- Mount the repository and source project read-only.
- Copy the source project into a writable `tmpfs` workspace before any mutation.
- Mount `/workspace` with `noexec`, UID/GID 1000, and `mode=0700` so only the
  container user can inspect project data.
- Keep npm and npx's executable cache at `NPM_CONFIG_CACHE=/tmp/npm-cache` on
  the executable `/tmp` mount. Its default size is 2 GiB and can be adjusted
  with `ECC_TMPFS_SIZE`; `ECC_WORKSPACE_SIZE` separately controls the private
  workspace mount.
- Set `read_only: true`, `no-new-privileges:true`, `cap_drop: [ALL]`, and a finite `pids_limit`.
- Keep the default real-CLI services on `network_mode: none`. Add network access
  only through a visibly named opt-in service for an authenticated provider
  session; never make it an accidental environment-driven default.
- Create only the writable temporary paths the tool needs.
- Do not pass host credentials into the container by default.
- Default to a dry run and whitelist only the explicit `dry-run`, `install`,
  `plugin`, and `shell` modes.
- Use argument arrays or `spawnSync(..., { shell: false })` for cross-platform runners. Never interpolate project paths into a shell command.

### Exercise the ECC Plugin Setup Harness

Use `docker/plugin-setup/compose.yaml` as the reference implementation. It provides:

- `fixture-tests` for the focused install manifest, target, and executor suite.
- `real-cli` for the pinned Debian-based generic Linux image.
- `real-cli-ubuntu` for the pinned Ubuntu image.

Validate the Compose model before building:

```bash
docker compose -f docker/plugin-setup/compose.yaml config --quiet
```

Build both real Linux images:

```bash
docker compose -f docker/plugin-setup/compose.yaml \
  build real-cli real-cli-ubuntu
```

Run the safe default flow in each image:

```bash
docker compose -p ecc-plugin-debian-test \
  -f docker/plugin-setup/compose.yaml \
  run --rm -T real-cli dry-run

docker compose -p ecc-plugin-ubuntu-test \
  -f docker/plugin-setup/compose.yaml \
  run --rm -T real-cli-ubuntu dry-run
```

The dry run executes the current public command contract:

```bash
ecc install --profile core --target claude-project --dry-run --json
```

Before that command runs, the container creates a locally packed npm artifact
from the read-only checkout with `npm pack --ignore-scripts`. It extracts the
self-created tarball under `/tmp`, validates the `ecc-universal` package name,
required install manifests, and the confined `package.json` `bin.ecc` mapping,
then invokes the extracted `ecc` executable. The runtime stays on
`network_mode: none`, does not execute package lifecycle scripts, and does not
rely on host `node_modules`; its exact pinned production dependencies are
already present in the image.

The harness rejects an empty plan, a non-`claude-project` target, any operation
outside `/workspace/project/.claude`, or any dry run that creates the target
directory. `install` performs the isolated apply twice, checks its managed
install state, lists the installed target, and runs `doctor`.

### Start, Open, Reconnect, and Clean Up a Named Session

Start a detached container without `--rm` so leaving a terminal does not remove
the session:

```bash
docker compose -p ecc-plugin-session \
  -f docker/plugin-setup/compose.yaml \
  run --detach --name ecc-plugin-shell real-cli shell
```

The container copies the read-only fixture to the stable private directory
`/workspace/project`. Confirm it is running, then emit the Docker side of the
terminal-opener v1 data contract:

```bash
docker inspect --format '{{.State.Running}}' ecc-plugin-shell
node docker/plugin-setup/interactive-plan.js \
  --container ecc-plugin-shell \
  --workdir /workspace/project \
  --json \
  -- bash
```

The JSON result has exactly an `executable` and `argv` boundary (plus
`contractVersion: 1`): the executable is `docker`, and argv begins with
`exec`, `-it`, and `-w`. Pass that data to the separate terminal-opener skill
when it is installed. This Docker harness deliberately does not import a
terminal adapter, interpolate a shell command, or manage a host GUI process.
Until then, open the same PTY in the current host terminal directly:

```bash
docker exec -it -w /workspace/project ecc-plugin-shell bash
```

Exit the shell without stopping the detached container. Reconnect with the
same `docker exec -it` command. When finished, remove the exact named container
and its Compose project resources:

```bash
docker rm --force ecc-plugin-shell
docker compose -p ecc-plugin-session \
  -f docker/plugin-setup/compose.yaml \
  down --remove-orphans
```

Host credentials are absent by default and credential directories are never
mounted. The default service also has no network access. When an authenticated
provider session genuinely needs a network, build `real-cli` first and then opt
in visibly with `docker compose --profile networked run real-cli-networked
shell`. Prefer authenticating inside that disposable session. If a CI run must
inherit a host environment credential, make that opt-in at invocation with an
explicit Compose `--env NAME` flag, understand that the value is inspectable
and can be exfiltrated for the container lifetime, and remove the exact named
container immediately after.

### Authenticate Codex Inside the Networked Session

`codex login` binds its OAuth callback server to `127.0.0.1:1455` inside the
container. A Docker port publish forwards to the container interface, not
loopback, so the host browser's redirect to `http://localhost:1455` is refused
without a bridge. The `real-cli-networked` service publishes host
`127.0.0.1:1455` to container port `1456`; bridge that port to loopback before
logging in:

```bash
npm install --global @openai/codex   # the harness image does not ship codex
node /ecc/docker/plugin-setup/codex-auth-relay.js &
codex login
```

Complete the sign-in in the host browser. Each attempt mints a fresh
`state`/`code`, so always follow the newest printed link. The token stays in
the disposable container's `~/.codex/auth.json`; removing the named container
revokes that copy. Only one container can hold host port 1455 at a time
because the OAuth redirect targets a fixed port.

Run the same focused suite natively on the host:

```bash
npm run test:plugin-setup-platform
```

Inspect the produced identity and environment before trusting the image:

```bash
docker image inspect ecc-plugin-setup:debian ecc-plugin-setup:ubuntu
```

Clean each named test project without deleting unrelated volumes or images:

```bash
docker compose -p ecc-plugin-debian-test \
  -f docker/plugin-setup/compose.yaml down --remove-orphans
docker compose -p ecc-plugin-ubuntu-test \
  -f docker/plugin-setup/compose.yaml down --remove-orphans
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

## Debugging

### Common Commands

```bash
# View logs
docker compose logs -f app           # Follow app logs
docker compose logs --tail=50 db     # Last 50 lines from db

# Execute commands in running container
docker compose exec app sh           # Shell into app
docker compose exec db psql -U postgres  # Connect to postgres

# Inspect
docker compose ps                     # Running services
docker compose top                    # Processes in each container
docker stats                          # Resource usage

# Rebuild
docker compose up --build             # Rebuild images
docker compose build --no-cache app   # Force full rebuild

# Clean up
docker compose down                   # Stop and remove containers
docker compose down -v                # Also remove volumes (DESTRUCTIVE)
docker system prune                   # Remove unused images/containers
```

### Debugging Network Issues

```bash
# Check DNS resolution inside container
docker compose exec app nslookup db

# Check connectivity
docker compose exec app wget -qO- http://api:3000/health

# Inspect network
docker network ls
docker network inspect <project>_default
```

## Anti-Patterns

```
# BAD: Using docker compose in production without orchestration
# Use Kubernetes, ECS, or Docker Swarm for production multi-container workloads

# BAD: Storing data in containers without volumes
# Containers are ephemeral -- all data lost on restart without volumes

# BAD: Running as root
# Always create and use a non-root user

# BAD: Using :latest tag
# Pin to specific versions for reproducible builds

# BAD: One giant container with all services
# Separate concerns: one process per container

# BAD: Putting secrets in docker-compose.yml
# Use .env files (gitignored) or Docker secrets
```
