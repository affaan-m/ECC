---
name: hexagonal-architecture
description: 设计、实现并重构端口与适配器系统，具有清晰的领域边界、依赖反转以及跨 TypeScript、Java、Kotlin 和 Go 服务的可测试用例编排。
origin: ECC
---

# 六边形架构

六边形架构（端口与适配器）使业务逻辑独立于框架、传输层和持久化细节。核心应用依赖于抽象端口，而适配器在边缘实现这些端口。

## 适用场景

* 构建需要长期可维护性和可测试性的新功能。
* 重构分层或框架密集型代码，其中领域逻辑与I/O关注点混杂。
* 为同一用例支持多种接口（HTTP、CLI、队列工作器、定时任务）。
* 替换基础设施（数据库、外部API、消息总线）而无需重写业务规则。

当需求涉及边界、领域驱动设计、重构紧耦合服务，或将应用逻辑与特定库解耦时，使用此技能。

## 核心概念

* **领域模型**：业务规则和实体/值对象。无框架导入。
* **用例（应用层）**：编排领域行为和工作流步骤。
* **入站端口**：描述应用能力的契约（命令/查询/用例接口）。
* **出站端口**：应用所需依赖的契约（仓库、网关、事件发布器、时钟、UUID等）。
* **适配器**：端口的基础设施和交付实现（HTTP控制器、数据库仓库、队列消费者、SDK封装器）。
* **组合根**：将具体适配器绑定到用例的单一连接位置。

出站端口接口通常位于应用层（仅当抽象真正属于领域层时才位于领域层），而基础设施适配器实现它们。

依赖方向始终向内：

* 适配器 -> 应用/领域
* 应用 -> 端口接口（入站/出站契约）
* 领域 -> 仅领域抽象（无框架或基础设施依赖）
* 领域 -> 无外部依赖

## 工作原理

### 步骤1：建模用例边界

定义具有清晰输入和输出DTO的单个用例。将传输细节（Express `req`、GraphQL `context`、任务负载包装器）保持在此边界之外。

### 步骤2：首先定义出站端口

将每个副作用识别为端口：

* 持久化（`UserRepositoryPort`）
* 外部调用（`BillingGatewayPort`）
* 横切关注点（`LoggerPort`、`ClockPort`）

端口应建模能力，而非技术。

### 步骤3：使用纯编排实现用例

用例类/函数通过构造函数/参数接收端口。它验证应用层不变量，协调领域规则，并返回纯数据结构。

### 步骤4：在边缘构建适配器

* 入站适配器将协议输入转换为用例输入。
* 出站适配器将应用契约映射到具体API/ORM/查询构建器。
* 映射保持在适配器中，而非用例内部。

### 步骤5：在组合根中连接所有组件

实例化适配器，然后将其注入用例。保持此连接集中化，以避免隐藏的服务定位器行为。

### 步骤6：按边界测试

* 使用伪造端口对用例进行单元测试。
* 使用真实基础设施依赖对适配器进行集成测试。
* 通过入站适配器对面向用户的流程进行端到端测试。

## 架构图

```mermaid
flowchart LR
  Client["Client (HTTP/CLI/Worker)"] --> InboundAdapter["Inbound Adapter"]
  InboundAdapter -->|"calls"| UseCase["UseCase (Application Layer)"]
  UseCase -->|"uses"| OutboundPort["OutboundPort (Interface)"]
  OutboundAdapter["Outbound Adapter"] -->|"implements"| OutboundPort
  OutboundAdapter --> ExternalSystem["DB/API/Queue"]
  UseCase --> DomainModel["DomainModel"]
```

## 建议的模块布局

使用以功能为先的组织方式，并带有显式边界：

```text
src/
  features/
    orders/
      domain/
        Order.ts
        OrderPolicy.ts
      application/
        ports/
          inbound/
            CreateOrder.ts
          outbound/
            OrderRepositoryPort.ts
            PaymentGatewayPort.ts
        use-cases/
          CreateOrderUseCase.ts
      adapters/
        inbound/
          http/
            createOrderRoute.ts
        outbound/
          postgres/
            PostgresOrderRepository.ts
          stripe/
            StripePaymentGateway.ts
      composition/
        ordersContainer.ts
```

## TypeScript 示例

### 端口定义

```typescript
export interface OrderRepositoryPort {
  save(order: Order): Promise<void>;
  findById(orderId: string): Promise<Order | null>;
}

export interface PaymentGatewayPort {
  authorize(input: { orderId: string; amountCents: number }): Promise<{ authorizationId: string }>;
}
```

### 用例

```typescript
type CreateOrderInput = {
  orderId: string;
  amountCents: number;
};

type CreateOrderOutput = {
  orderId: string;
  authorizationId: string;
};

export class CreateOrderUseCase {
  constructor(
    private readonly orderRepository: OrderRepositoryPort,
    private readonly paymentGateway: PaymentGatewayPort
  ) {}

  async execute(input: CreateOrderInput): Promise<CreateOrderOutput> {
    const order = Order.create({ id: input.orderId, amountCents: input.amountCents });

    const auth = await this.paymentGateway.authorize({
      orderId: order.id,
      amountCents: order.amountCents,
    });

    // markAuthorized returns a new Order instance; it does not mutate in place.
    const authorizedOrder = order.markAuthorized(auth.authorizationId);
    await this.orderRepository.save(authorizedOrder);

    return {
      orderId: order.id,
      authorizationId: auth.authorizationId,
    };
  }
}
```

### 出站适配器

```typescript
export class PostgresOrderRepository implements OrderRepositoryPort {
  constructor(private readonly db: SqlClient) {}

  async save(order: Order): Promise<void> {
    await this.db.query(
      "insert into orders (id, amount_cents, status, authorization_id) values ($1, $2, $3, $4)",
      [order.id, order.amountCents, order.status, order.authorizationId]
    );
  }

  async findById(orderId: string): Promise<Order | null> {
    const row = await this.db.oneOrNone("select * from orders where id = $1", [orderId]);
    return row ? Order.rehydrate(row) : null;
  }
}
```

### 组合根

```typescript
export const buildCreateOrderUseCase = (deps: { db: SqlClient; stripe: StripeClient }) => {
  const orderRepository = new PostgresOrderRepository(deps.db);
  const paymentGateway = new StripePaymentGateway(deps.stripe);

  return new CreateOrderUseCase(orderRepository, paymentGateway);
};
```

## 多语言映射

在不同生态系统中使用相同的边界规则；仅语法和连接方式发生变化。

* **TypeScript/JavaScript**
  * 端口：`application/ports/*` 作为接口/类型。
  * 用例：带有构造函数/参数注入的类/函数。
  * 适配器：`adapters/inbound/*`、`adapters/outbound/*`。
  * 组合：显式工厂/容器模块（无隐藏全局变量）。
* **Java**
  * 包：`domain`、`application.port.in`、`application.port.out`、`application.usecase`、`adapter.in`、`adapter.out`。
  * 端口：`application.port.*` 中的接口。
  * 用例：普通类（Spring `@Service` 是可选的，非必需）。
  * 组合：Spring配置或手动连接类；将连接逻辑保持在领域/用例类之外。
* **Kotlin**
  * 模块/包镜像Java的拆分（`domain`、`application.port`、`application.usecase`、`adapter`）。
  * 端口：Kotlin接口。
  * 用例：带有构造函数注入的类（Koin/Dagger/Spring/手动）。
  * 组合：模块定义或专用组合函数；避免服务定位器模式。
* **Go**
  * 包：`internal/<feature>/domain`、`application`、`ports`、`adapters/inbound`、`adapters/outbound`。
  * 端口：由消费应用包拥有的小型接口。
  * 用例：带有接口字段和显式 `New...` 构造函数的结构体。
  * 组合：在 `cmd/<app>/main.go` 中连接（或专用连接包），保持构造函数显式。

## 应避免的反模式

* 领域实体导入ORM模型、Web框架类型或SDK客户端。
* 用例直接从 `req`、`res` 或队列元数据读取。
* 从用例直接返回数据库行，未经领域/应用映射。
* 让适配器直接相互调用，而非通过用例端口流转。
* 将依赖连接分散到多个文件中，使用隐藏的全局单例。

## 迁移手册

1. 选择一个垂直切片（单个端点/任务），该切片频繁变更且带来痛苦。
2. 提取具有显式输入/输出类型的用例边界。
3. 围绕现有基础设施调用引入出站端口。
4. 将编排逻辑从控制器/服务移动到用例中。
5. 保留旧适配器，但使其委托给新用例。
6. 围绕新边界添加测试（单元测试 + 适配器集成测试）。
7. 逐个切片重复；避免完全重写。

### 重构现有系统

* **绞杀者模式**：保留当前端点，一次将一个用例路由到新的端口/适配器。
* **无大爆炸式重写**：按功能切片迁移，并通过特征化测试保持行为。
* **先建外观**：在替换内部实现之前，将遗留服务包装在出站端口后面。
* **组合冻结**：尽早集中连接，使新依赖不会泄漏到领域/用例层。
* **切片选择规则**：优先处理高变更频率、低影响范围的流程。
* **回滚路径**：为每个迁移的切片保留可逆开关或路由切换，直到生产行为得到验证。

## 测试指南（相同的六边形边界）

* **领域测试**：将实体/值对象作为纯业务规则进行测试（无模拟，无框架设置）。
* **用例单元测试**：使用出站端口的伪造/桩件测试编排；断言业务结果和端口交互。
* **出站适配器契约测试**：在端口级别定义共享契约套件，并针对每个适配器实现运行。
* **入站适配器测试**：验证协议映射（HTTP/CLI/队列负载到用例输入，以及输出/错误映射回协议）。
* **适配器集成测试**：针对真实基础设施（数据库/API/队列）运行，测试序列化、模式/查询行为、重试和超时。
* **端到端测试**：覆盖关键用户旅程，通过入站适配器 -> 用例 -> 出站适配器。
* **重构安全性**：在提取之前添加特征化测试；保持它们直到新边界行为稳定且等价。

## 最佳实践清单

* 领域和应用层仅导入内部类型和端口。
* 每个外部依赖都由一个出站端口表示。
* 验证发生在边界处（入站适配器 + 用例不变量）。
* 使用不可变转换（返回新值/实体，而非修改共享状态）。
* 错误在边界间进行转换（基础设施错误 -> 应用/领域错误）。
* 组合根是显式的且易于审计。
* 用例可通过简单的内存伪造端口进行测试。
* 重构从具有行为保持测试的一个垂直切片开始。
* 语言/框架特定内容保持在适配器中，绝不进入领域规则。
