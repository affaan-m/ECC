# Delivery Reliability

Read this reference when changing acknowledgement settings, worker-loss behavior,
or task publication around Django database transactions.

## Acknowledgement and Worker Loss

Celery acknowledges task messages before execution by default. Opt in to late
acknowledgement only for idempotent tasks that are safe to execute more than once:

```python
@shared_task(
    name='orders.mark_shipped',
    acks_late=True,
)
def mark_order_shipped(order_id: int, tracking_number: str) -> None:
    # Use an idempotent implementation such as the guarded update in SKILL.md.
    ...
```

Late acknowledgement means the task may execute more than once if delivery is
interrupted. It does not by itself guarantee redelivery when a worker child exits
abruptly. Celery acknowledges worker-loss messages unless
`task_reject_on_worker_lost` (or Django's
`CELERY_TASK_REJECT_ON_WORKER_LOST`) is enabled. That option can cause message loops
for poison tasks, so enable it only after validating idempotency and monitoring the
redelivery path. Failure and timeout acknowledgement behavior is controlled
separately by `task_acks_on_failure_or_timeout`.

## Publish After the Database Commits

With Celery 5.4 or newer, `delay_on_commit()` is available for tasks based on
`DjangoTask`. Custom task base classes must inherit from `DjangoTask` to expose this
API. The method does not return a task ID because the message is not published until
commit.

For older Celery versions or when `apply_async()` options are required, register the
publication explicitly:

```python
from functools import partial
from django.db import transaction

transaction.on_commit(
    partial(
        sync_contact_to_crm.apply_async,
        args=[contact.pk],
        queue='high_priority',
    )
)
```

An on-commit callback avoids publication on rollback, but it does not make the
database commit and broker publish atomic. If task delivery must not be lost when a
publish fails after commit, use a transactional outbox with a separate publisher.
