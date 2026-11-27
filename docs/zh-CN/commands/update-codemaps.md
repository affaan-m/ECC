# 更新代码地图

分析代码库结构并生成简洁的架构文档。

## 步骤 1：扫描项目结构

1. 识别项目类型（单体仓库、单应用、库、微服务）
2. 查找所有源码目录（src/, lib/, app/, packages/）
3. 映射入口点（main.ts, index.ts, app.py, main.go 等）

## 步骤 2：生成代码地图

在 `docs/CODEMAPS/`（或 `.reports/codemaps/`）中创建或更新代码地图：

| 文件 | 内容 |
|------|----------|
| `architecture.md` | 高层系统图、服务边界、数据流 |
| `backend.md` | API 路由、中间件链、服务 → 仓库映射 |
| `frontend.md` | 页面树、组件层级、状态管理流 |
| `data.md` | 数据库表、关系、迁移历史 |
| `dependencies.md` | 外部服务、第三方集成、共享库 |

### 代码地图格式

每个代码地图应为简洁风格 —— 针对 AI 上下文消费进行优化：

```markdown
# 后端架构

## 路由
POST /api/users → UserController.create → UserService.create → UserRepo.insert
GET  /api/users/:id → UserController.get → UserService.findById → UserRepo.findById

## 关键文件
src/services/user.ts (业务逻辑，120行)
src/repos/user.ts (数据库访问，80行)

## 依赖项
- PostgreSQL (主要数据存储)
- Redis (会话缓存，速率限制)
- Stripe (支付处理)
```

## 步骤 3：差异检测

1. 如果存在先前的代码地图，计算差异百分比
2. 如果变更 > 30%，显示差异并在覆盖前请求用户批准
3. 如果变更 <= 30%，则原地更新

## 步骤 4：添加元数据

为每个代码地图添加一个新鲜度头部：

```markdown
<!-- Generated: 2026-02-11 | Files scanned: 142 | Token estimate: ~800 -->
```

## 步骤 5：保存分析报告

将摘要写入 `.reports/codemap-diff.txt`：

* 自上次扫描以来添加/删除/修改的文件
* 检测到的新依赖项
* 架构变更（新路由、新服务等）
* 超过 90 天未更新的文档的陈旧警告

## 提示

* 关注**高层结构**，而非实现细节
* 优先使用**文件路径和函数签名**，而非完整代码块
* 为高效加载上下文，将每个代码地图保持在 **1000 个 token 以内**
* 使用 ASCII 图表表示数据流，而非冗长的描述
* 在主要功能添加或重构会话后运行
