---
name: x-api
description: X/Twitter API集成，用于发布推文、线程、读取时间线、搜索和分析。涵盖OAuth认证模式、速率限制和平台原生内容发布。当用户希望以编程方式与X交互时使用。
origin: ECC
---

# X API

以编程方式与 X（Twitter）交互，用于发布、读取、搜索和分析。

## 何时激活

* 用户希望以编程方式发布推文或帖子串
* 从 X 读取时间线、提及或用户数据
* 在 X 上搜索内容、趋势或对话
* 构建 X 集成或机器人
* 分析和参与度跟踪
* 用户提及"发布到 X"、"发推"、"X API"或"Twitter API"

## 认证

### OAuth 2.0 Bearer 令牌（仅应用）

最佳适用场景：读取密集型操作、搜索、公开数据。

```bash
# Environment setup
export X_BEARER_TOKEN="your-bearer-token"
```

```python
import os
import requests

bearer = os.environ["X_BEARER_TOKEN"]
headers = {"Authorization": f"Bearer {bearer}"}

# Search recent tweets
resp = requests.get(
    "https://api.x.com/2/tweets/search/recent",
    headers=headers,
    params={"query": "claude code", "max_results": 10}
)
tweets = resp.json()
```

### OAuth 1.0a（用户上下文）

必需用于：发布推文、管理账户、私信。

```bash
# Environment setup — source before use
export X_API_KEY="your-api-key"
export X_API_SECRET="your-api-secret"
export X_ACCESS_TOKEN="your-access-token"
export X_ACCESS_SECRET="your-access-secret"
```

```python
import os
from requests_oauthlib import OAuth1Session

oauth = OAuth1Session(
    os.environ["X_API_KEY"],
    client_secret=os.environ["X_API_SECRET"],
    resource_owner_key=os.environ["X_ACCESS_TOKEN"],
    resource_owner_secret=os.environ["X_ACCESS_SECRET"],
)
```

## 核心操作

### 发布一条推文

```python
resp = oauth.post(
    "https://api.x.com/2/tweets",
    json={"text": "Hello from Claude Code"}
)
resp.raise_for_status()
tweet_id = resp.json()["data"]["id"]
```

### 发布一个帖子串

```python
def post_thread(oauth, tweets: list[str]) -> list[str]:
    ids = []
    reply_to = None
    for text in tweets:
        payload = {"text": text}
        if reply_to:
            payload["reply"] = {"in_reply_to_tweet_id": reply_to}
        resp = oauth.post("https://api.x.com/2/tweets", json=payload)
        tweet_id = resp.json()["data"]["id"]
        ids.append(tweet_id)
        reply_to = tweet_id
    return ids
```

### 读取用户时间线

```python
resp = requests.get(
    f"https://api.x.com/2/users/{user_id}/tweets",
    headers=headers,
    params={
        "max_results": 10,
        "tweet.fields": "created_at,public_metrics",
    }
)
```

### 搜索推文

```python
resp = requests.get(
    "https://api.x.com/2/tweets/search/recent",
    headers=headers,
    params={
        "query": "from:affaanmustafa -is:retweet",
        "max_results": 10,
        "tweet.fields": "public_metrics,created_at",
    }
)
```

### 通过用户名获取用户

```python
resp = requests.get(
    "https://api.x.com/2/users/by/username/affaanmustafa",
    headers=headers,
    params={"user.fields": "public_metrics,description,created_at"}
)
```

### 上传媒体并发布

```python
# Media upload uses v1.1 endpoint

# Step 1: Upload media
media_resp = oauth.post(
    "https://upload.twitter.com/1.1/media/upload.json",
    files={"media": open("image.png", "rb")}
)
media_id = media_resp.json()["media_id_string"]

# Step 2: Post with media
resp = oauth.post(
    "https://api.x.com/2/tweets",
    json={"text": "Check this out", "media": {"media_ids": [media_id]}}
)
```

## 速率限制

X API 的速率限制因端点、认证方法和账户等级而异，并且会随时间变化。请始终：

* 在硬编码假设之前，查看当前的 X 开发者文档
* 在运行时读取 `x-rate-limit-remaining` 和 `x-rate-limit-reset` 头部信息
* 自动退避，而不是依赖代码中的静态表格

```python
import time

remaining = int(resp.headers.get("x-rate-limit-remaining", 0))
if remaining < 5:
    reset = int(resp.headers.get("x-rate-limit-reset", 0))
    wait = max(0, reset - int(time.time()))
    print(f"Rate limit approaching. Resets in {wait}s")
```

## 错误处理

```python
resp = oauth.post("https://api.x.com/2/tweets", json={"text": content})
if resp.status_code == 201:
    return resp.json()["data"]["id"]
elif resp.status_code == 429:
    reset = int(resp.headers["x-rate-limit-reset"])
    raise Exception(f"Rate limited. Resets at {reset}")
elif resp.status_code == 403:
    raise Exception(f"Forbidden: {resp.json().get('detail', 'check permissions')}")
else:
    raise Exception(f"X API error {resp.status_code}: {resp.text}")
```

## 安全性

* **切勿硬编码令牌。** 使用环境变量或 `.env` 文件。
* **切勿提交 `.env` 文件。** 将其添加到 `.gitignore`。
* **如果令牌暴露，请轮换令牌。** 在 developer.x.com 重新生成。
* **当不需要写权限时，使用只读令牌。**
* **安全存储 OAuth 密钥** — 不要存储在源代码或日志中。

## 与内容引擎集成

使用 `content-engine` 技能生成平台原生内容，然后通过 X API 发布：

1. 使用内容引擎生成内容（X 平台格式）
2. 验证长度（单条推文 280 字符）
3. 使用上述模式通过 X API 发布
4. 通过 public\_metrics 跟踪参与度

## 相关技能

* `content-engine` — 为 X 生成平台原生内容
* `crosspost` — 在 X、LinkedIn 和其他平台分发内容
