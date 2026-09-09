"""Temporary SQLite state-machine tests. No transport, authority or provider calls."""

import hashlib
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor


ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / 'skills/operator-approval-loop/references'
SPEC = importlib.util.spec_from_file_location('approval_claims', REFERENCE / 'approval_claims.py')
if (REFERENCE / 'approval_claims.py').exists():
    claims = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(claims)
else:
    claims = None


class DraftedObligationsTest(unittest.TestCase):
    """Draft queue uniqueness is separate from authorization and delivery claims."""

    def setUp(self):
        self.db = sqlite3.connect(':memory:', isolation_level=None)
        self.addCleanup(self.db.close)
        self.schema = (REFERENCE / 'approval-ledger.sql').read_text()
        self.db.executescript(self.schema)

    def insert_obligation(self, identifier, status='drafted', counterparty='synthetic', channel='channel-a'):
        self.db.execute(
            'INSERT INTO obligations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (identifier, counterparty, 'test', channel, 'we_owe_them', status, 'fixture', 1, 1, 10),
        )

    def rows(self):
        return self.db.execute('SELECT * FROM obligations ORDER BY id').fetchall()

    def test_duplicate_drafted_insert_is_rejected_without_changing_existing_row(self):
        self.insert_obligation(1)
        before = self.rows()
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_obligation(2)
        self.assertEqual(self.rows(), before)

    def test_transition_into_drafted_is_rejected_until_prior_draft_leaves_queue(self):
        self.insert_obligation(1)
        self.insert_obligation(2, status='open')
        before = self.rows()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE obligations SET status='drafted' WHERE id=2")
        self.assertEqual(self.rows(), before)
        self.db.execute("UPDATE obligations SET status='approved' WHERE id=1")
        self.db.execute("UPDATE obligations SET status='drafted' WHERE id=2")
        self.assertEqual(self.db.execute('SELECT id,status FROM obligations ORDER BY id').fetchall(),
                         [(1, 'approved'), (2, 'drafted')])

    def test_non_drafted_states_do_not_reserve_the_draft_queue(self):
        for identifier, status in enumerate(['open', 'approved', 'rejected', 'sent', 'closed'], start=1):
            self.insert_obligation(identifier, status=status)
        self.insert_obligation(6)
        self.assertEqual(len(self.rows()), 6)

    def test_distinct_counterparty_or_channel_can_each_have_a_draft(self):
        self.insert_obligation(1)
        self.insert_obligation(2, counterparty='synthetic-other')
        self.insert_obligation(3, channel='channel-b')
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE obligations SET channel='channel-a' WHERE id=3")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE obligations SET counterparty='synthetic' WHERE id=2")
        self.assertEqual(len(self.rows()), 3)

    def test_existing_duplicate_drafts_stop_schema_upgrade_without_deleting_data(self):
        # Model the prior ledger, which allowed multiple drafts for the same pair.
        self.db.execute('DROP INDEX IF EXISTS one_drafted_obligation_per_counterparty_channel')
        self.insert_obligation(1)
        self.insert_obligation(2)
        before = self.rows()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.executescript(self.schema)
        self.assertEqual(self.rows(), before)
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='index' AND name=?",
            ('one_drafted_obligation_per_counterparty_channel',),
        ).fetchone()[0], 0)

    def test_compatible_schema_upgrade_and_reapplication_preserve_rows(self):
        self.db.execute('DROP INDEX IF EXISTS one_drafted_obligation_per_counterparty_channel')
        self.insert_obligation(1)
        self.insert_obligation(2, status='closed')
        before = self.rows()
        self.db.executescript(self.schema)
        self.db.executescript(self.schema)
        self.assertEqual(self.rows(), before)
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_obligation(3)


class DeliveryClaimsTest(unittest.TestCase):
    def setUp(self):
        if claims is None:
            self.fail('approval_claims.py reference has not been implemented')
        self.directory = tempfile.TemporaryDirectory(prefix='approval-claims-')
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'ledger.sqlite'
        self.path.touch()
        self.db = claims.connect(self.path)
        self.addCleanup(self.db.close)
        self.db.executescript((REFERENCE / 'approval-ledger.sql').read_text())
        self.authorized_fixture()

    def authorized_fixture(self, obligation=1, decision=1, epoch=10, digest=None):
        """Trusted test setup supplies prior authorization; the reference never does."""
        text = 'Synthetic approved text'
        if digest is None:
            digest = hashlib.sha256(text.encode()).hexdigest()
        self.db.execute(
            'INSERT INTO obligations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (obligation, 'synthetic', 'test', 'channel-a', 'we_owe_them', 'approved', 'fixture', 1, 1, epoch),
        )
        self.db.execute(
            '''INSERT INTO obligation_drafts
               (obligation_id,draft_text,origin_platform,origin_channel,origin_thread,
                draft_sha256,created_ts,updated_ts) VALUES (?,?,?,?,?,?,?,?)''',
            (obligation, text, 'test', 'channel-a', 'thread-a', digest, 1, epoch),
        )
        self.authorized_decision(obligation, decision, epoch)

    def authorized_decision(self, obligation, decision, epoch):
        self.db.execute('INSERT INTO obligation_decisions VALUES (?,?,?,?,?,?,?)',
                        (decision, obligation, 'approve', 'trusted-fixture', epoch, f'nonce-{decision}', epoch))
        self.db.execute(
            '''INSERT INTO obligation_approval_snapshots
               (decision_id,obligation_id,draft_epoch,draft_text,draft_sha256,
                origin_platform,origin_channel,origin_thread,kind)
               SELECT ?,obligation_id,?,draft_text,draft_sha256,
                      origin_platform,origin_channel,origin_thread,'draft_sent'
                 FROM obligation_drafts WHERE obligation_id=?''',
            (decision, epoch, obligation),
        )

    def scalar(self, sql, args=()):
        return self.db.execute(sql, args).fetchone()[0]

    def state(self, token):
        return self.scalar('SELECT state FROM obligation_delivery_claims WHERE token=?', (token,))

    def reserve(self, decision=1):
        return claims.claim(self.db, 1, decision, now=20)

    def test_open_missing_database_does_not_create_it(self):
        missing = Path(self.directory.name) / 'missing.sqlite'
        with self.assertRaises(sqlite3.OperationalError):
            claims.connect(missing)
        self.assertFalse(missing.exists())

    def test_database_filename_is_not_interpreted_as_uri_options(self):
        path = Path(self.directory.name) / 'ledger ?#%.sqlite'
        path.touch()
        db = claims.connect(path)
        try:
            db.execute('CREATE TABLE marker (value TEXT)')
            self.assertEqual(Path(db.execute('PRAGMA database_list').fetchone()[2]), path.resolve())
        finally:
            db.close()

    def test_malformed_approved_hashes_fail_closed_with_claim_error(self):
        for number, digest in enumerate(['é', b'bad', 'A' * 64, 'g' * 64], start=2):
            with self.subTest(digest=digest):
                self.authorized_fixture(number, number, digest=digest)
                with self.assertRaises(claims.ClaimError):
                    claims.claim(self.db, number, number, now=20)
                self.assertFalse(self.db.in_transaction)
        self.assertEqual(self.scalar('SELECT count(*) FROM obligation_delivery_claims'), 0)

    def test_two_connections_one_dispatch_and_receipt(self):
        self.race([1, 1])

    def test_different_decisions_same_obligation_cannot_bypass_claim(self):
        self.authorized_decision(1, 2, 10)
        self.race([1, 2])

    def race(self, decisions):
        barrier = threading.Barrier(2)
        attempts = []
        lock = threading.Lock()

        def worker(decision):
            connection = claims.connect(self.path)
            try:
                barrier.wait(timeout=5)
                try:
                    token = claims.claim(connection, 1, decision, now=20)
                except claims.ClaimError:
                    return 'denied'
                payload = claims.begin_dispatch(connection, token, now=21)
                with lock:
                    attempts.append(payload['draft_text'])
                claims.complete(connection, token, 'synthetic-receipt', now=22)
                return 'delivered'
            finally:
                connection.close()

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(worker, decisions))
        self.assertCountEqual(outcomes, ['denied', 'delivered'])
        self.assertEqual(attempts, ['Synthetic approved text'])
        self.assertEqual(self.scalar('SELECT count(*) FROM obligation_deliveries'), 1)

    def test_binding_changes_deny_claim(self):
        changes = [
            ('UPDATE obligations SET updated_at=11', ()),
            ("UPDATE obligations SET direction='they_owe_us'", ()),
            ("UPDATE obligations SET status='rejected'", ()),
            ("UPDATE obligation_decisions SET decision='reject'", ()),
            ('UPDATE obligation_decisions SET draft_updated_ts=11', ()),
            ('UPDATE obligation_drafts SET updated_ts=11', ()),
            ("UPDATE obligation_drafts SET draft_text='rewritten'", ()),
            ("UPDATE obligation_drafts SET draft_sha256='bad'", ()),
            ("UPDATE obligation_drafts SET origin_platform='other'", ()),
            ("UPDATE obligation_drafts SET origin_channel='other'", ()),
            ("UPDATE obligation_drafts SET origin_thread=NULL", ()),
            ('DELETE FROM obligation_drafts', ()),
        ]
        for sql, args in changes:
            with self.subTest(sql=sql):
                self.db.execute('SAVEPOINT invalid')
                self.db.execute(sql, args)
                # Commit mutation on another fresh fixture copy: claim must own its transaction.
                copy_path = Path(self.directory.name) / 'invalid.sqlite'
                copy_path.touch(exist_ok=True)
                copy = claims.connect(copy_path)
                try:
                    # Serialize includes the uncommitted test mutation without sharing a transaction.
                    copy.deserialize(self.db.serialize())
                    with self.assertRaises(claims.ClaimError):
                        claims.claim(copy, 1, 1, now=20)
                finally:
                    copy.close()
                self.db.execute('ROLLBACK TO invalid')
                self.db.execute('RELEASE invalid')

    def test_matching_stored_hash_is_not_enough(self):
        # A bad hash present at approval time must still fail the computed-hash check.
        self.authorized_fixture(2, 2)
        self.db.execute('DELETE FROM obligation_drafts WHERE obligation_id=2')
        self.db.execute('''INSERT INTO obligation_drafts
            (obligation_id,draft_text,origin_platform,origin_channel,origin_thread,draft_sha256,created_ts,updated_ts)
            VALUES (2,'Synthetic approved text','test','channel-a','thread-a','0000000000000000000000000000000000000000000000000000000000000000',1,10)''')
        self.db.execute('INSERT INTO obligation_decisions VALUES (3,2,\'approve\',\'fixture\',10,\'nonce-3\',10)')
        self.db.execute('''INSERT INTO obligation_approval_snapshots VALUES
            (3,2,10,'Synthetic approved text','0000000000000000000000000000000000000000000000000000000000000000','test','channel-a','thread-a','draft_sent')''')
        with self.assertRaisesRegex(claims.ClaimError, 'approved text hash does not match'):
            claims.claim(self.db, 2, 3, now=20)

    def test_cross_obligation_pair_and_legacy_decision_are_denied(self):
        self.authorized_fixture(2, 2)
        with self.assertRaises(claims.ClaimError):
            claims.claim(self.db, 1, 2, now=20)
        self.db.execute('INSERT INTO obligation_decisions VALUES (3,1,\'approve\',\'fixture\',10,\'nonce-3\',10)')
        with self.assertRaises(claims.ClaimError):
            claims.claim(self.db, 1, 3, now=20)
        self.assertEqual(self.scalar('SELECT count(*) FROM obligation_approval_snapshots'), 2)

    def test_snapshot_cannot_be_changed_deleted_or_replaced(self):
        for sql in [
            "UPDATE obligation_approval_snapshots SET draft_text='changed'",
            'DELETE FROM obligation_approval_snapshots',
            'INSERT OR REPLACE INTO obligation_approval_snapshots SELECT * FROM obligation_approval_snapshots',
        ]:
            with self.subTest(sql=sql), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(sql)

    def test_active_claim_freezes_authorization_and_cannot_be_erased(self):
        token = self.reserve()
        statements = [
            'UPDATE obligations SET updated_at=11', 'DELETE FROM obligations',
            "UPDATE obligation_drafts SET origin_channel='changed'", 'DELETE FROM obligation_drafts',
            "UPDATE obligation_decisions SET decision='reject'", 'DELETE FROM obligation_decisions',
            'INSERT OR REPLACE INTO obligation_drafts SELECT * FROM obligation_drafts',
            'INSERT OR REPLACE INTO obligations SELECT * FROM obligations',
            'DELETE FROM obligation_delivery_claims',
            "UPDATE obligation_delivery_claims SET token='replacement'",
            "UPDATE obligation_delivery_claims SET state='delivered'",
        ]
        for sql in statements:
            with self.subTest(sql=sql), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(sql)
        self.assertEqual(self.state(token), 'claimed')

    def test_cancel_before_dispatch_fences_old_token_and_allows_new_approval(self):
        token = self.reserve()
        claims.cancel(self.db, token, now=21)
        with self.assertRaises(claims.ClaimError):
            claims.begin_dispatch(self.db, token, now=22)
        with self.assertRaises(claims.ClaimError):
            self.reserve()
        self.db.execute('UPDATE obligations SET updated_at=11')
        self.db.execute('UPDATE obligation_drafts SET updated_ts=11')
        self.authorized_decision(1, 2, 11)
        next_token = self.reserve(2)
        self.assertNotEqual(token, next_token)
        self.assertEqual(claims.begin_dispatch(self.db, next_token, now=22)['draft_epoch'], 11)

    def test_begin_dispatch_only_once_and_payload_is_bound(self):
        token = self.reserve()
        payload = claims.begin_dispatch(self.db, token, now=21)
        self.assertEqual(payload['draft_text'], 'Synthetic approved text')
        self.assertEqual((payload['origin_platform'], payload['origin_channel'], payload['origin_thread']),
                         ('test', 'channel-a', 'thread-a'))
        self.assertEqual(payload['decision_id'], 1)
        self.assertFalse(self.db.in_transaction)
        with self.assertRaises(claims.ClaimError):
            claims.begin_dispatch(self.db, token, now=22)
        with self.assertRaises(claims.ClaimError):
            claims.cancel(self.db, token, now=22)

    def test_wrong_token_cannot_transition(self):
        token = self.reserve()
        for operation, args in [(claims.begin_dispatch, ()), (claims.cancel, ()),
                                (claims.mark_unknown, ()), (claims.complete, ('receipt',))]:
            with self.subTest(operation=operation.__name__), self.assertRaises(claims.ClaimError):
                operation(self.db, 'wrong-token', *args, now=21)
        self.assertEqual(self.state(token), 'claimed')

    def test_caller_transaction_never_grants_uncommitted_permission(self):
        self.db.execute('BEGIN IMMEDIATE')
        with self.assertRaises(claims.ClaimError):
            self.reserve()
        self.db.rollback()
        token = self.reserve()
        self.db.execute('BEGIN IMMEDIATE')
        with self.assertRaises(claims.ClaimError):
            claims.begin_dispatch(self.db, token, now=21)
        self.db.rollback()
        self.assertEqual(self.state(token), 'claimed')

    def test_missing_connection_guards_fail_closed(self):
        for pragma in ['foreign_keys', 'recursive_triggers']:
            self.db.execute(f'PRAGMA {pragma}=OFF')
            with self.assertRaises(claims.ClaimError):
                self.reserve()
            self.db.execute(f'PRAGMA {pragma}=ON')

    def test_crash_before_claim_commit_rolls_back_on_reopen(self):
        connection = claims.connect(self.path)
        connection.execute('BEGIN IMMEDIATE')
        connection.execute('''INSERT INTO obligation_delivery_claims
            (obligation_id,decision_id,token,state,created_ts,updated_ts)
            VALUES (1,1,'uncommitted','claimed',20,20)''')
        connection.close()
        self.assertEqual(self.scalar('SELECT count(*) FROM obligation_delivery_claims'), 0)
        self.assertEqual(self.state(self.reserve()), 'claimed')

    def test_claim_survives_reopen_without_granting_dispatch_twice(self):
        token = self.reserve()
        self.db.close()
        self.db = claims.connect(self.path)
        self.addCleanup(self.db.close)
        self.assertEqual(self.state(token), 'claimed')
        with self.assertRaises(claims.ClaimError):
            self.reserve()
        claims.cancel(self.db, token, now=21)

    def test_crash_after_begin_remains_held_even_without_a_send(self):
        self.authorized_decision(1, 2, 10)
        token = self.reserve()
        claims.begin_dispatch(self.db, token, now=21)
        self.db.close()
        self.db = claims.connect(self.path)
        self.addCleanup(self.db.close)
        self.assertEqual(self.state(token), 'dispatching')
        claims.mark_unknown(self.db, token, now=22)
        claims.mark_unknown(self.db, token, now=23)
        for decision in [1, 2]:
            with self.assertRaises(claims.ClaimError):
                self.reserve(decision)
        with self.assertRaises(claims.ClaimError):
            claims.cancel(self.db, token, now=24)
        with self.assertRaises(claims.ClaimError):
            claims.begin_dispatch(self.db, token, now=24)

    def test_completion_is_atomic_and_identical_repeats_are_noops(self):
        token = self.reserve()
        claims.begin_dispatch(self.db, token, now=21)
        self.assertTrue(claims.complete(self.db, token, 'synthetic-coordinate', now=22))
        self.assertFalse(claims.complete(self.db, token, 'synthetic-coordinate', now=23))
        self.assertEqual(self.state(token), 'delivered')
        self.assertEqual(self.scalar('SELECT status FROM obligations'), 'sent')
        self.assertEqual(self.scalar('SELECT count(*) FROM obligation_deliveries'), 1)
        with self.assertRaises(claims.ClaimError):
            claims.complete(self.db, token, 'contradiction', now=24)
        for sql in ['DELETE FROM obligation_deliveries', "UPDATE obligation_deliveries SET coordinate='other'"]:
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(sql)

    def test_failed_completion_after_possible_send_does_not_enable_retry(self):
        token = self.reserve()
        claims.begin_dispatch(self.db, token, now=21)
        attempts = ['simulated external effect']
        self.db.execute('''CREATE TEMP TRIGGER fail_completion BEFORE UPDATE OF status ON obligations
            WHEN NEW.status='sent' BEGIN SELECT RAISE(ABORT,'injected failure'); END''')
        with self.assertRaises(claims.ClaimError):
            claims.complete(self.db, token, 'receipt', now=22)
        self.assertEqual(self.scalar('SELECT count(*) FROM obligation_deliveries'), 0)
        self.assertEqual(self.scalar('SELECT status FROM obligations'), 'approved')
        self.assertEqual(self.state(token), 'dispatching')
        claims.mark_unknown(self.db, token, now=23)
        with self.assertRaises(claims.ClaimError):
            claims.begin_dispatch(self.db, token, now=24)
        self.assertEqual(len(attempts), 1)

    def test_unknown_requires_explicit_evidence_and_never_reopens(self):
        token = self.reserve()
        claims.begin_dispatch(self.db, token, now=21)
        claims.mark_unknown(self.db, token, now=22)
        with self.assertRaises(claims.ClaimError):
            claims.complete(self.db, token, 'receipt', now=23)
        with self.assertRaises(claims.ClaimError):
            claims.reconcile(self.db, token, 'receipt', '', now=23)
        self.assertTrue(claims.reconcile(self.db, token, 'receipt', 'trusted synthetic evidence', now=24))
        self.assertEqual(self.state(token), 'delivered')
        self.assertFalse(claims.reconcile(self.db, token, 'receipt', 'trusted synthetic evidence', now=25))

    def test_empty_coordinate_cannot_complete(self):
        token = self.reserve()
        claims.begin_dispatch(self.db, token, now=21)
        for coordinate in ['', '  ', None]:
            with self.subTest(coordinate=coordinate), self.assertRaises(claims.ClaimError):
                claims.complete(self.db, token, coordinate, now=22)
        self.assertEqual(self.state(token), 'dispatching')

    def test_legacy_receipts_remain_readable_and_deny_a_new_claim(self):
        self.db.execute('INSERT INTO obligation_deliveries VALUES (1,1,1,\'draft_sent\',\'legacy\',12)')
        self.assertEqual(self.scalar('SELECT coordinate FROM obligation_deliveries'), 'legacy')
        with self.assertRaises(claims.ClaimError):
            self.reserve()


if __name__ == '__main__':
    unittest.main()
