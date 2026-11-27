---
name: deployment-patterns
description: Deployment iş akışları, CI/CD pipeline kalıpları, Docker konteynerizasyonu, sağlık kontrolleri, rollback stratejileri ve web uygulamaları için üretim hazırlığı kontrol listeleri.
origin: ECC
---

# Deployment Kalıpları

Üretim deployment iş akışları ve CI/CD en iyi uygulamaları.

## Ne Zaman Aktifleştirmeli

- CI/CD pipeline'ları kurarken
- Bir uygulamayı Docker'ize ederken
- Deployment stratejisi planlarken (blue-green, canary, rolling)
- Sağlık kontrolleri ve hazırlık probe'ları uygularken
- Üretim yayınına hazırlanırken
- Ortama özgü ayarları yapılandırırken

## Deployment Stratejileri

### Rolling Deployment (Varsayılan)

Instance'ları kademeli olarak değiştir — rollout sırasında eski ve yeni versiyonlar birlikte çalışır.

```
Instance 1: v1 → v2  (önce güncelle)
Instance 2: v1        (hala v1 çalışıyor)
Instance 3: v1        (hala v1 çalışıyor)

Instance 1: v2
Instance 2: v1 → v2  (ikinci olarak güncelle)
Instance 3: v1

Instance 1: v2
Instance 2: v2
Instance 3: v1 → v2  (son olarak güncelle)
```

**Artıları:** Sıfır kesinti, kademeli rollout
**Eksileri:** İki versiyon aynı anda çalışır — geriye uyumlu değişiklikler gerektirir
**Ne zaman kullanılır:** Standart deployment'lar, geriye uyumlu değişiklikler

### Blue-Green Deployment

İki özdeş ortam çalıştır. Trafiği atomik olarak değiştir.

```
Blue  (v1) ← trafik
Green (v2)   boşta, yeni versiyon çalışıyor

# Doğrulamadan sonra:
Blue  (v1)   boşta (yedek haline gelir)
Green (v2) ← trafik
```

**Artıları:** Anında rollback (blue'ya geri dön), temiz geçiş
**Eksileri:** Deployment sırasında 2x altyapı gerektirir
**Ne zaman kullanılır:** Kritik servisler, sorunlara sıfır tolerans

### Canary Deployment

Önce trafiğin küçük bir yüzdesini yeni versiyona yönlendir.

```
v1: %95 trafik
v2:  %5 trafik  (canary)

# Metrikler iyi görünüyorsa:
v1: %50 trafik
v2: %50 trafik

# Final:
v2: %100 trafik
```

**Artıları:** Tam rollout'tan önce gerçek trafikle sorunları yakalar
**Eksileri:** Trafik bölme altyapısı, izleme gerektirir
**Ne zaman kullanılır:** Yüksek trafikli servisler, riskli değişiklikler, feature flag'ler

## Docker

### Multi-Stage Dockerfile (Node.js)

```dockerfile
# Stage 1: Bağımlılıkları yükle
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Stage 2: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm prune --production

# Stage 3: Production image
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

### Multi-Stage Dockerfile (Go)

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

### Multi-Stage Dockerfile (Python/Django)

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

### Docker En İyi Uygulamaları

```
# İYİ uygulamalar
- Belirli versiyon tag'leri kullanın (node:22-alpine, node:latest değil)
- Image boyutunu minimize etmek için multi-stage build'ler
- Root olmayan kullanıcı olarak çalıştır
- Önce bağımlılık dosyalarını kopyalayın (layer caching)
- node_modules, .git, test'leri hariç tutmak için .dockerignore kullanın
- HEALTHCHECK talimatı ekleyin
- docker-compose veya k8s'te kaynak limitleri ayarlayın

# KÖTÜ uygulamalar
- Root olarak çalıştırmak
- :latest tag'lerini kullanmak
- Tüm repo'yu tek COPY layer'da kopyalamak
- Production image'de dev bağımlılıklarını yüklemek
- Image'de secret'ları saklamak (env var veya secrets manager kullanın)
```

## CI/CD Pipeline

### GitHub Actions (Standart Pipeline)

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
          # Platforma özgü deployment komutu
          # Railway: railway up
          # Vercel: vercel --prod
          # K8s: kubectl set image deployment/app app=ghcr.io/${{ github.repository }}:${{ github.sha }}
          echo "Deploying ${{ github.sha }}"
```

### Pipeline Aşamaları

```
PR açıldığında:
  lint → typecheck → unit tests → integration tests → preview deploy

Main'e merge edildiğinde:
  lint → typecheck → unit tests → integration tests → build image → deploy staging → smoke tests → deploy production
```

## Sağlık Kontrolleri

### Sağlık Kontrolü Endpoint'i

```typescript
// Basit sağlık kontrolü
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Detaylı sağlık kontrolü (dahili izleme için)
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

### Kubernetes Probe'ları

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
  failureThreshold: 30    # 30 * 5s = 150s max başlatma süresi
```

## Ortam Yapılandırması

### Twelve-Factor App Kalıbı

```bash
# Tüm yapılandırma ortam değişkenleri ile — asla kodda değil
DATABASE_URL=postgres://user:pass@host:5432/db
REDIS_URL=redis://host:6379/0
API_KEY=${API_KEY}           # secrets manager tarafından enjekte edilir
LOG_LEVEL=info
PORT=3000

# Ortama özgü davranış
NODE_ENV=production          # veya staging, development
APP_ENV=production           # açık uygulama ortamı
```

### Yapılandırma Validasyonu

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

// Başlangıçta validasyon yap — yapılandırma yanlışsa hızlı başarısız ol
export const env = envSchema.parse(process.env);
```

## Rollback Stratejisi

### Anında Rollback

```bash
# Docker/Kubernetes: önceki image'a işaret et
kubectl rollout undo deployment/app

# Vercel: önceki deployment'ı yükselt
vercel rollback

# Railway: önceki commit'i tekrar deploy et
railway up --commit <previous-sha>

# Veritabanı: migration'ı rollback et (geri alınabilirse)
npx prisma migrate resolve --rolled-back <migration-name>
```

### Rollback Kontrol Listesi

- [ ] Önceki image/artifact mevcut ve tag'lenmiş
- [ ] Veritabanı migration'ları geriye uyumlu (yıkıcı değişiklik yok)
- [ ] Feature flag'ler deploy olmadan yeni özellikleri devre dışı bırakabilir
- [ ] Hata oranı artışları için izleme alarmları yapılandırılmış
- [ ] Rollback üretim yayınından önce staging'de test edilmiş

## Üretim Hazırlığı Kontrol Listesi

Herhangi bir üretim deployment'ından önce:

### Uygulama
- [ ] Tüm testler geçiyor (unit, integration, E2E)
- [ ] Kodda veya yapılandırma dosyalarında hardcode edilmiş secret yok
- [ ] Hata işleme tüm edge case'leri kapsıyor
- [ ] Loglama yapılandırılmış (JSON) ve PII içermiyor
- [ ] Sağlık kontrolü endpoint'i anlamlı durum döndürüyor

### Altyapı
- [ ] Docker image yeniden üretilebilir şekilde build oluyor (sabitlenmiş versiyonlar)
- [ ] Ortam değişkenleri dokümante edilmiş ve başlangıçta validate ediliyor
- [ ] Kaynak limitleri ayarlanmış (CPU, bellek)
- [ ] Horizontal scaling yapılandırılmış (min/max instance'lar)
- [ ] Tüm endpoint'lerde SSL/TLS etkin

### İzleme
- [ ] Uygulama metrikleri export ediliyor (istek oranı, gecikme, hatalar)
- [ ] Hata oranı > eşik için alarmlar yapılandırılmış
- [ ] Log toplama kurulmuş (yapılandırılmış loglar, aranabilir)
- [ ] Sağlık endpoint'inde uptime izleme

### Güvenlik
- [ ] Bağımlılıklar CVE'ler için taranmış
- [ ] CORS sadece izin verilen origin'ler için yapılandırılmış
- [ ] Halka açık endpoint'lerde hız sınırlama etkin
- [ ] Kimlik doğrulama ve yetkilendirme doğrulanmış
- [ ] Güvenlik header'ları ayarlanmış (CSP, HSTS, X-Frame-Options)

### Operasyonlar
- [ ] Rollback planı dokümante edilmiş ve test edilmiş
- [ ] Veritabanı migration'ı üretim boyutundaki veriye karşı test edilmiş
- [ ] Yaygın hata senaryoları için runbook
- [ ] Nöbet rotasyonu ve yükseltme yolu tanımlanmış
