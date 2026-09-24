---
name: django-celery
description: DjangoおよびCeleryを使用した非同期タスク処理。タスクキューイング、ワーカー管理、エラー処理、スケジューリング。Redis/RabbitMQ ブローカー統合。
origin: ECC
---

# Django + Celery 非同期タスク

Django でのバックグラウンドジョブと非同期処理。

## 使用時期

- メール送信をバックグラウンドで実行
- 重い処理をスケジュール
- 定期的なタスクを実行（日報、クリーンアップ）
- 外部API呼び出しをキューイング
- 複雑なワークフローを調整

## セットアップ

### 1. Celery インストール

```bash
pip install celery redis
```

### 2. タスク定義

```python
from celery import shared_task

@shared_task
def send_email(recipient):
    # メール送信ロジック
    pass
```

### 3. ワーカー起動

```bash
celery -A myapp worker -l info
```

## タスク

### 非同期実行

```python
send_email.delay(recipient)  # すぐにキューに追加、非同期実行
```

### スケジューリング

```python
from celery.schedules import crontab

app.conf.beat_schedule = {
    'send-report-daily': {
        'task': 'app.tasks.send_report',
        'schedule': crontab(hour=9, minute=0),
    },
}
```

## エラーハンドリング

- [ ] リトライロジック実装
- [ ] デッドレター処理
- [ ] ロギング構成
- [ ] モニタリング設定（Flower）

詳細については、ドキュメントを参照してください。
