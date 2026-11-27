---
name: docker-patterns
description: Yerel geliştirme, konteyner güvenliği, ağ, volume stratejileri ve multi-servis orkestrasyon için Docker ve Docker Compose kalıpları.
origin: ECC
---

# Docker Kalıpları

Konteynerize edilmiş geliştirme için Docker ve Docker Compose en iyi uygulamaları.

## Ne Zaman Aktifleştirmeli

- Yerel geliştirme için Docker Compose kurarken
- Çok konteynerli mimariler tasarlarken
- Konteyner ağ veya volume sorunlarını giderirken
- Dockerfile'ları güvenlik ve boyut için incelerken
- Yerel geliştirmeden konteynerize iş akışına geçerken

## Yerel Geliştirme için Docker Compose

### Standart Web Uygulaması Stack'i

```yaml
# docker-compose.yml
services:
  app:
    build:
      context: .
      target: dev                     # Multi-stage Dockerfile'ın dev aşamasını kullan
    ports:
      - "3000:3000"
    volumes:
      - .:/app                        # Hot reload için bind mount
      - /app/node_modules             # Anonim volume -- konteyner bağımlılıklarını korur
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

  mailpit:                            # Yerel email testi
    image: axllent/mailpit
    ports:
      - "8025:8025"                   # Web UI
      - "1025:1025"                   # SMTP

volumes:
  pgdata:
  redisdata:
```

### Geliştirme vs Üretim Dockerfile

```dockerfile
# Aşama: bağımlılıklar
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Aşama: dev (hot reload, debug araçları)
FROM node:22-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Aşama: build
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --production

# Aşama: production (minimal image)
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

### Override Dosyaları

```yaml
# docker-compose.override.yml (otomatik yüklenir, sadece dev ayarları)
services:
  app:
    environment:
      - DEBUG=app:*
      - LOG_LEVEL=debug
    ports:
      - "9229:9229"                   # Node.js debugger

# docker-compose.prod.yml (üretim için açıkça)
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
# Geliştirme (override'ı otomatik yükler)
docker compose up

# Üretim
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Ağ (Networking)

### Servis Keşfi

Aynı Compose ağındaki servisler servis adıyla çözümlenir:
```
# "app" konteynerinden:
postgres://postgres:postgres@db:5432/app_dev    # "db" db konteynerine çözümlenir
redis://redis:6379/0                             # "redis" redis konteynerine çözümlenir
```

### Özel Ağlar

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
      - backend-net              # Sadece api'den erişilebilir, frontend'den değil

networks:
  frontend-net:
  backend-net:
```

### Sadece Gereklileri Açığa Çıkarma

```yaml
services:
  db:
    ports:
      - "127.0.0.1:5432:5432"   # Sadece host'tan erişilebilir, ağdan değil
    # Üretimde port'ları tamamen çıkar -- sadece Docker ağı içinden erişilebilir
```

## Volume Stratejileri

```yaml
volumes:
  # İsimli volume: konteyner yeniden başlatmalarında kalıcı, Docker tarafından yönetilir
  pgdata:

  # Bind mount: host dizinini konteynere eşler (geliştirme için)
  # - ./src:/app/src

  # Anonim volume: bind mount override'ından konteyner tarafından oluşturulan içeriği korur
  # - /app/node_modules
```

### Yaygın Kalıplar

```yaml
services:
  app:
    volumes:
      - .:/app                   # Kaynak kodu (hot reload için bind mount)
      - /app/node_modules        # Konteyner'ın node_modules'ünü host'tan koru
      - /app/.next               # Build cache'ini koru

  db:
    volumes:
      - pgdata:/var/lib/postgresql/data          # Kalıcı veri
      - ./scripts/init.sql:/docker-entrypoint-initdb.d/init.sql  # Init scriptleri
```

## Konteyner Güvenliği

### Dockerfile Sıkılaştırma

```dockerfile
# 1. Belirli tag'ler kullanın (:latest asla)
FROM node:22.12-alpine3.20

# 2. Root olmayan kullanıcı olarak çalıştır
RUN addgroup -g 1001 -S app && adduser -S app -u 1001
USER app

# 3. Capability'leri düşür (compose'da)
# 4. Mümkün olduğunda salt okunur kök dosya sistemi
# 5. Image layer'larında secret yok
```

### Compose Güvenliği

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
      - NET_BIND_SERVICE          # Sadece < 1024 port'lara bind için
```

### Secret Yönetimi

```yaml
# İYİ: Ortam değişkenleri kullanın (runtime'da enjekte edilir)
services:
  app:
    env_file:
      - .env                     # .env'i asla git'e commit etmeyin
    environment:
      - API_KEY                  # Host ortamından miras alır

# İYİ: Docker secrets (Swarm modu)
secrets:
  db_password:
    file: ./secrets/db_password.txt

services:
  db:
    secrets:
      - db_password

# KÖTÜ: Image'de hardcode
# ENV API_KEY=sk-proj-xxxxx      # ASLA BUNU YAPMAYIN
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

## Hata Ayıklama

### Yaygın Komutlar

```bash
# Logları görüntüle
docker compose logs -f app           # App loglarını takip et
docker compose logs --tail=50 db     # db'den son 50 satır

# Çalışan konteynerde komut çalıştır
docker compose exec app sh           # app'e shell ile gir
docker compose exec db psql -U postgres  # postgres'e bağlan

# İncele
docker compose ps                     # Çalışan servisler
docker compose top                    # Her konteynerdeki işlemler
docker stats                          # Kaynak kullanımı

# Yeniden build et
docker compose up --build             # Image'leri yeniden build et
docker compose build --no-cache app   # Tam rebuild'i zorla

# Temizle
docker compose down                   # Konteynerleri durdur ve kaldır
docker compose down -v                # Volume'leri de kaldır (YIKıCı)
docker system prune                   # Kullanılmayan image/konteynerleri kaldır
```

### Ağ Sorunlarını Hata Ayıklama

```bash
# Konteyner içinde DNS çözümlemesini kontrol et
docker compose exec app nslookup db

# Bağlantıyı kontrol et
docker compose exec app wget -qO- http://api:3000/health

# Ağı incele
docker network ls
docker network inspect <project>_default
```

## Anti-Kalıplar

```
# KÖTÜ: Üretimde orkestrasyon olmadan docker compose kullanma
# Üretim çok konteynerli iş yükleri için Kubernetes, ECS veya Docker Swarm kullanın

# KÖTÜ: Volume olmadan konteynerlerde veri depolama
# Konteynerler geçicidir -- volume olmadan yeniden başlatmada tüm veri kaybolur

# KÖTÜ: Root olarak çalıştırma
# Daima root olmayan bir kullanıcı oluşturun ve kullanın

# KÖTÜ: :latest tag kullanma
# Yeniden üretilebilir build'ler için belirli versiyonlara sabitle

# KÖTÜ: Tüm servisleri içeren tek dev konteyner
# Endişeleri ayırın: konteyner başına bir işlem

# KÖTÜ: Secret'ları docker-compose.yml'e koymak
# .env dosyaları (gitignore'lanmış) veya Docker secrets kullanın
```
