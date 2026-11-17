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
separately by `task_acks_on_failure_or_timeout`, which applies only to tasks using
late acknowledgement.

## Publish After the Database Commits

With Celery 5.4 or newer, `delay_on_commit()` and `apply_async_on_commit()` are
available for tasks based on `DjangoTask`. Custom task base classes must inherit from
`DjangoTask` to expose this API. These methods do not return a task ID because the
message is not published until commit.

For older Celery versions, or to keep the publication visible at the call site,
register it explicitly:

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

## Test the On-Commit Contract

Django's `TestCase` wraps each test in a transaction that is rolled back, never
committed, so `transaction.on_commit()` callbacks (including `delay_on_commit()`)
never run. A test that only checks the new database row still passes when the task
is never queued. Capture the callbacks, execute them, and assert the Celery call:

```python
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase

from apps.users.services import create_user
from apps.users.tasks import send_welcome_email


class CreateUserTests(TestCase):
    def test_queues_welcome_email_after_commit(self):
        # Patch before the call: delay_on_commit() binds task.delay when it registers.
        with patch.object(send_welcome_email, 'delay') as mock_delay:
            with self.captureOnCommitCallbacks(execute=True) as callbacks:
                create_user('bob')
                mock_delay.assert_not_called()  # Not published before commit

        user = User.objects.get(username='bob')
        self.assertEqual(len(callbacks), 1)
        mock_delay.assert_called_once_with(user.pk)
```

`captureOnCommitCallbacks()` is available on `TestCase` in Django 3.2 or newer. With
pytest-django, the `django_capture_on_commit_callbacks` fixture provides the same
context manager inside `@pytest.mark.django_db` tests.

Use `TransactionTestCase`, or `@pytest.mark.django_db(transaction=True)`, only when a
test needs a real commit: for example, when a real Celery worker in another thread
or process must read the committed rows. Those tests commit for real, so on-commit
callbacks run when the outermost `atomic()` block commits, and Django resets the
database afterwards by truncating tables, which is much slower. Keep them for the
worker integration boundary and use `TestCase` with captured callbacks elsewhere.
