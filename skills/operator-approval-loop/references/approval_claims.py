"""SQLite dispatch-permission reference, not a sender or approval authority.

The trusted decision writer supplies immutable approval snapshots. This module
never creates decisions/snapshots or calls transport. It assumes a trusted local
database, all writers honoring schema guards, and callers checking permission.
Unknown outcomes stay held; receipt evidence is supplied by a trusted caller.
"""

from contextlib import contextmanager
import hashlib
from pathlib import Path
import secrets
import sqlite3


class ClaimError(Exception):
    """No dispatch permission or state transition was granted."""


def connect(path):
    """Open an existing caller-selected database; never apply schema/migrations."""
    uri = Path(path).resolve().as_uri() + '?mode=rw'
    db = sqlite3.connect(uri, uri=True, isolation_level=None, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA recursive_triggers=ON')
    return db


@contextmanager
def _transaction(db, now):
    # Never return permission whose commit belongs to an outer caller transaction.
    if db.in_transaction:
        raise ClaimError('a top-level committed transaction is required')
    if type(now) is not int or now < 0:
        raise ClaimError('now must be a nonnegative integer')
    if any(db.execute(f'PRAGMA {name}').fetchone()[0] != 1
           for name in ('foreign_keys', 'recursive_triggers')):
        raise ClaimError('required SQLite guards are disabled')
    try:
        db.execute('BEGIN IMMEDIATE')
        yield
        db.commit()
    except BaseException as error:
        db.rollback()
        if isinstance(error, sqlite3.Error):
            raise ClaimError('claim transaction failed; no permission granted') from error
        raise


def _snapshot(db, obligation_id, decision_id):
    row = db.execute('''SELECT * FROM approval_bound_drafts
        WHERE obligation_id=? AND decision_id=?''', (obligation_id, decision_id)).fetchone()
    if row is None:
        raise ClaimError('a current bound approved draft is required')
    try:
        digest = hashlib.sha256(row['draft_text'].encode('utf-8')).hexdigest()
    except (AttributeError, UnicodeError) as error:
        raise ClaimError('approved text must be valid UTF-8 text') from error
    stored_digest = row['draft_sha256']
    if (not isinstance(stored_digest, str) or len(stored_digest) != 64
            or any(character not in '0123456789abcdef' for character in stored_digest)):
        raise ClaimError('approved hash must be lowercase SHA-256 hexadecimal')
    if not secrets.compare_digest(digest, stored_digest):
        raise ClaimError('approved text hash does not match')
    return dict(row)


def _claim_row(db, token):
    if not isinstance(token, str) or not token:
        raise ClaimError('a claim token is required')
    row = db.execute('SELECT * FROM obligation_delivery_claims WHERE token=?', (token,)).fetchone()
    if row is None:
        raise ClaimError('unknown claim token')
    return row


def claim(db, obligation_id, decision_id, *, now):
    """Reserve one already-authorized decision; return only a random claim token."""
    with _transaction(db, now):
        _snapshot(db, obligation_id, decision_id)
        token = secrets.token_hex(32)
        db.execute('''INSERT INTO obligation_delivery_claims
            (obligation_id,decision_id,token,state,created_ts,updated_ts)
            VALUES (?,?,?,'claimed',?,?)''', (obligation_id, decision_id, token, now, now))
    return token


def begin_dispatch(db, token, *, now):
    """Return bound payload once, only after dispatching state has committed.

    A crash after this boundary is uncertain even if transport has not started.
    Do not cache/reuse this return value for another attempt.
    """
    with _transaction(db, now):
        row = _claim_row(db, token)
        if row['state'] != 'claimed':
            raise ClaimError('claim cannot grant another dispatch')
        payload = _snapshot(db, row['obligation_id'], row['decision_id'])
        changed = db.execute('''UPDATE obligation_delivery_claims SET state='dispatching',updated_ts=?
            WHERE token=? AND state='claimed' ''', (now, token)).rowcount
        if changed != 1:
            raise ClaimError('dispatch transition lost')
    return payload


def cancel(db, token, *, now):
    """Cancel only a not-yet-dispatched claim. Never reopen its decision key."""
    with _transaction(db, now):
        row = _claim_row(db, token)
        if row['state'] != 'claimed':
            raise ClaimError('only a pre-dispatch claim can be cancelled')
        db.execute("UPDATE obligation_delivery_claims SET state='cancelled',updated_ts=? WHERE token=?",
                   (now, token))


def mark_unknown(db, token, *, now):
    """Record uncertainty, including a restarted worker's dispatching claim."""
    with _transaction(db, now):
        row = _claim_row(db, token)
        if row['state'] == 'unknown':
            return
        if row['state'] != 'dispatching':
            raise ClaimError('only a dispatched attempt can become unknown')
        db.execute("UPDATE obligation_delivery_claims SET state='unknown',updated_ts=? WHERE token=?",
                   (now, token))


def _finish(db, token, coordinate, now, evidence):
    if not isinstance(coordinate, str) or not coordinate.strip():
        raise ClaimError('a confirmed nonempty coordinate is required')
    with _transaction(db, now):
        row = _claim_row(db, token)
        receipt = db.execute('''SELECT * FROM obligation_deliveries
            WHERE obligation_id=? AND decision_id=?''',
                             (row['obligation_id'], row['decision_id'])).fetchone()
        if row['state'] == 'delivered':
            if receipt is None or receipt['coordinate'] != coordinate or receipt['kind'] != 'draft_sent':
                raise ClaimError('completion contradicts the existing receipt')
            return False
        expected_state = 'dispatching' if evidence is None else 'unknown'
        if row['state'] != expected_state:
            raise ClaimError('completion requires the correct dispatch/reconciliation state')
        _snapshot(db, row['obligation_id'], row['decision_id'])
        db.execute('''INSERT INTO obligation_deliveries
            (obligation_id,decision_id,kind,coordinate,delivered_ts) VALUES (?,?,'draft_sent',?,?)''',
                   (row['obligation_id'], row['decision_id'], coordinate, now))
        db.execute('''UPDATE obligation_delivery_claims
            SET state='delivered',updated_ts=?,reconciliation_evidence=? WHERE token=?''',
                   (now, evidence, token))
        changed = db.execute("UPDATE obligations SET status='sent' WHERE id=? AND status='approved'",
                             (row['obligation_id'],)).rowcount
        if changed != 1:
            raise ClaimError('obligation completion failed')
    return True


def complete(db, token, coordinate, *, now):
    """Atomically record a confirmed result; identical duplicate completion is a no-op."""
    return _finish(db, token, coordinate, now, None)


def reconcile(db, token, coordinate, evidence, *, now):
    """Trusted caller supplies verified outcome evidence; this does not verify it.

    No cancellation/retry of unknown claims is provided: a paused original
    executor could still act. Operator authentication is outside this reference.
    """
    if not isinstance(evidence, str) or not evidence.strip():
        raise ClaimError('trusted reconciliation evidence is required')
    return _finish(db, token, coordinate, now, evidence)
