# CONTRACT.md —— 前后端数据接口契约

> 前后端的**唯一真相源**。所有接口只在这里定义一次,前端照它写界面、后端照它写实现。
> **只有契约主任（contract-director）能改本文件。** 前端/后端只读。
> 想改接口 → 找主任改这里 → 两边再各自对齐。绝不在实现里单方偏离。

## 第一层 · 契约宪法（所有接口共享的铁律，很少变，改它影响全局）

> 字段命名、类型、版本、错误格式这类**跨接口的铁律**，所有具体接口必须服从。改这里 = 影响所有接口，最慎重。

| 项 | 约定 |
|---|---|
| 基础路径 | `/api` |
| 认证 | 请求头 `Authorization: Bearer <token>` |
| 时间格式 | ISO 8601 字符串,如 `2026-06-17T20:15:00+08:00` |
| 金额 | `number`,单位**元**,保留 2 位小数 |
| 商品/订单 ID | **`string`**(19 位,**绝不用 number,会截零**) |
| 分页 | 请求 `?page=1&size=20`;返回 `{ items, total, page, size }` |
| 错误响应 | `{ "error": { "code": string, "message": string } }`,HTTP 状态码语义化 |

## 第二层 · 具体契约（每个接口一段，必须服从上面的契约宪法）

### GET /api/orders/{id} —— 查单个订单

**请求**

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `id` | path | string | 是 | 订单 ID,19 位 |

**返回 200**

```jsonc
{
  "orderId":   "string",        // 19位订单ID,字符串
  "userName":  "string",        // 下单人(注意是 userName 不是 user_name)
  "amount":    0.00,            // number,单位元,2位小数
  "status":    "pending",       // 枚举: pending | paid | shipped | done | refunded
  "createdAt": "string",        // ISO 8601
  "items": [
    {
      "skuId":    "string",     // 19位商品ID,字符串
      "title":    "string",
      "price":    0.00,        // number,2位小数
      "quantity": 0            // 整数
    }
  ]
}
```

**错误**

| 状态码 | code | 何时 |
|---|---|---|
| 404 | `ORDER_NOT_FOUND` | 订单不存在 |
| 401 | `UNAUTHORIZED` | 未登录或 token 失效 |

---

### (按需继续追加接口,每个都写清:请求 / 返回逐字段 / 错误码)

---

## 变更须知

- 改任何接口 = 同一次改这份契约,并往 `PROJECT_LOG.md` 追加一条 `contract` 记录。
- 字段名、类型、枚举值一旦发布,前端可能已依赖;改它属于破坏性变更,主任要评估对前端的影响。
