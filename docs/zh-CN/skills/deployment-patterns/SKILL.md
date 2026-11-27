---
name: deployment-patterns
description: 部署工作流、CI/CD流水线模式、Docker容器化、健康检查、回滚策略以及Web应用程序的生产就绪检查清单。
origin: ECC
---

# 部署模式

生产环境部署工作流和 CI/CD 最佳实践。

## 何时启用

* 设置 CI/CD 流水线时
* 将应用容器化（Docker）时
* 规划部署策略（蓝绿、金丝雀、滚动）时
* 实现健康检查和就绪探针时
* 准备生产发布时
* 配置环境特定设置时

## 部署策略

### 滚动部署（默认）

逐步替换实例——在发布过程中，新旧版本同时运行。

```
实例 1: v1 → v2  (首次更新)
实例 2: v1        (仍在运行 v1)
实例 3: v1        (仍在运行 v1)

实例 1: v2
实例 2: v1 → v2  (第二次更新)
实例 3: v1

实例 1: v2
实例 2: v2
实例 3: v1 → v2  (最后更新)
```

**优点：** 零停机时间，渐进式发布
**缺点：** 两个版本同时运行——需要向后兼容的更改
**适用场景：** 标准部署，向后兼容的更改

### 蓝绿部署

运行两个相同的环境。原子化地切换流量。

```
Blue  (v1) ← 流量
Green (v2)   空闲，运行新版本

# 验证后：
Blue  (v1)   空闲（转为备用状态）
Green (v2) ← 流量
```

**优点：** 即时回滚（切换回蓝色环境），切换干净利落
**缺点：** 部署期间需要双倍的基础设施
**适用场景：** 关键服务，对问题零容忍

### 金丝雀部署

首先将一小部分流量路由到新版本。

```
v1：95% 的流量
v2：5% 的流量（金丝雀）

# 如果指标表现良好：
v1：50% 的流量
v2：50% 的流量

# 最终：
v2：100% 的流量
```

**优点：** 在全量发布前，通过真实流量发现问题
**缺点：** 需要流量分割基础设施和监控
**适用场景：** 高流量服务，风险性更改，功能标志

## Docker

### 多阶段 Dockerfile (Node.js)

```dockerfile
# Stage 1: Install dependencies
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

### 多阶段 Dockerfile (Go)

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

### 多阶段 Dockerfile (Python/Django)

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

### Docker 最佳实践

```
# 良好实践
- 使用特定版本标签（node:22-alpine，而非 node:latest）
- 采用多阶段构建以最小化镜像体积
- 以非 root 用户身份运行
- 优先复制依赖文件（利用分层缓存）
- 使用 .dockerignore 排除 node_modules、.git、tests 等文件
- 添加 HEALTHCHECK 指令
- 在 docker-compose 或 k8s 中设置资源限制

# 不良实践
- 以 root 身份运行
- 使用 :latest 标签
- 在单个 COPY 层中复制整个仓库
- 在生产镜像中安装开发依赖
- 在镜像中存储密钥（应使用环境变量或密钥管理器）
```

## CI/CD 流水线

### GitHub Actions (标准流水线)

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
          # Platform-specific deployment command
          # Railway: railway up
          # Vercel: vercel --prod
          # K8s: kubectl set image deployment/app app=ghcr.io/${{ github.repository }}:${{ github.sha }}
          echo "Deploying ${{ github.sha }}"
```

### 流水线阶段

```
PR 已开启：
  lint → typecheck → 单元测试 → 集成测试 → 预览部署

合并到 main：
  lint → typecheck → 单元测试 → 集成测试 → 构建镜像 → 部署到 staging → 冒烟测试 → 部署到 production
```

## 健康检查

### 健康检查端点

```typescript
// Simple health check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Detailed health check (for internal monitoring)
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

### Kubernetes 探针

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
  failureThreshold: 30    # 30 * 5s = 150s max startup time
```

## 环境配置

### 十二要素应用模式

```bash
# All config via environment variables — never in code
DATABASE_URL=postgres://user:pass@host:5432/db
REDIS_URL=redis://host:6379/0
API_KEY=${API_KEY}           # injected by secrets manager
LOG_LEVEL=info
PORT=3000

# Environment-specific behavior
NODE_ENV=production          # or staging, development
APP_ENV=production           # explicit app environment
```

### 配置验证

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

// Validate at startup — fail fast if config is wrong
export const env = envSchema.parse(process.env);
```

## 回滚策略

### 即时回滚

```bash
# Docker/Kubernetes: point to previous image
kubectl rollout undo deployment/app

# Vercel: promote previous deployment
vercel rollback

# Railway: redeploy previous commit
railway up --commit <previous-sha>

# Database: rollback migration (if reversible)
npx prisma migrate resolve --rolled-back <migration-name>
```

### 回滚检查清单

* \[ ] 之前的镜像/制品可用且已标记
* \[ ] 数据库迁移向后兼容（无破坏性更改）
* \[ ] 功能标志可以在不部署的情况下禁用新功能
* \[ ] 监控警报已配置，用于错误率飙升
* \[ ] 在生产发布前，回滚已在预演环境测试

## 生产就绪检查清单

在任何生产部署之前：

### 应用

* \[ ] 所有测试通过（单元、集成、端到端）
* \[ ] 代码或配置文件中没有硬编码的密钥
* \[ ] 错误处理覆盖所有边缘情况
* \[ ] 日志是结构化的（JSON）且不包含 PII
* \[ ] 健康检查端点返回有意义的状态

### 基础设施

* \[ ] Docker 镜像可重复构建（版本已固定）
* \[ ] 环境变量已记录并在启动时验证
* \[ ] 资源限制已设置（CPU、内存）
* \[ ] 水平伸缩已配置（最小/最大实例数）
* \[ ] 所有端点均已启用 SSL/TLS

### 监控

* \[ ] 应用指标已导出（请求率、延迟、错误）
* \[ ] 已配置错误率超过阈值的警报
* \[ ] 日志聚合已设置（结构化日志，可搜索）
* \[ ] 健康端点有正常运行时间监控

### 安全

* \[ ] 依赖项已扫描 CVE
* \[ ] CORS 仅配置允许的来源
* \[ ] 公共端点已启用速率限制
* \[ ] 身份验证和授权已验证
* \[ ] 安全头已设置（CSP、HSTS、X-Frame-Options）

### 运维

* \[ ] 回滚计划已记录并测试
* \[ ] 数据库迁移已针对生产规模的数据进行测试
* \[ ] 常见故障场景的应急预案
* \[ ] 待命轮换和升级路径已定义
