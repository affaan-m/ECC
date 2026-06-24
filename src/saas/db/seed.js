'use strict';
/**
 * Seed script — creates demo org, user, alert source, and sample incidents.
 * Run: node src/saas/db/seed.js
 */
const db = require('./client');
const crypto = require('crypto');

async function seed() {
  console.log('Seeding demo data...');

  // Org
  const org = await db.query(
    `INSERT INTO organizations (name, slug, plan)
     VALUES ('Acme Corp', 'acme', 'team')
     ON CONFLICT (slug) DO UPDATE SET plan = 'team'
     RETURNING id`
  );
  const orgId = org.rows[0].id;
  console.log(`  Org: ${orgId}`);

  // User
  const user = await db.query(
    `INSERT INTO users (org_id, email, name, role, oncall)
     VALUES ($1, 'demo@acme.com', 'Demo User', 'owner', true)
     ON CONFLICT (email) DO UPDATE SET org_id = $1
     RETURNING id`,
    [orgId]
  );
  const userId = user.rows[0].id;
  console.log(`  User: ${userId}`);

  // API key
  const rawKey = 'ira_live_demo_key_1234567890abcdef';
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  await db.query(
    `INSERT INTO api_keys (org_id, name, key_hash, key_prefix, scopes)
     VALUES ($1, 'Demo Key', $2, 'ira_live', ARRAY['*'])
     ON CONFLICT (key_hash) DO NOTHING`,
    [orgId, keyHash]
  );
  console.log(`  API Key: ${rawKey}`);

  // Alert source
  const src = await db.query(
    `INSERT INTO alert_sources (org_id, name, type, webhook_token)
     VALUES ($1, 'Production Datadog', 'datadog', 'demo-webhook-token-abc123xyz')
     ON CONFLICT (webhook_token) DO UPDATE SET org_id = $1
     RETURNING id`,
    [orgId]
  );
  const srcId = src.rows[0].id;
  console.log(`  Alert source: ${srcId}`);

  // Slack notification channel (demo — no real webhook)
  await db.query(
    `INSERT INTO notification_channels (org_id, name, type, config, min_severity)
     VALUES ($1, 'Slack #incidents', 'slack', '{"webhook_url":"https://hooks.slack.com/demo"}', 2)
     ON CONFLICT DO NOTHING`,
    [orgId]
  );

  // Sample incidents
  const samples = [
    { title: 'Payments API — Error rate 8% on POST /checkout', service: 'payments-api', severity: 1, status: 'investigating', source_type: 'datadog', summary: 'Error rate spiking on checkout endpoint since deploy v2.3.1 at 09:55 UTC.' },
    { title: 'Auth service — Login failures for EU users', service: 'auth-service', severity: 2, status: 'mitigating', source_type: 'pagerduty', summary: 'JWT validation errors affecting ~15% of EU login attempts. Possible cert issue.' },
    { title: 'Order API — p99 latency > 8s on GET /orders', service: 'order-api', severity: 2, status: 'open', source_type: 'cloudwatch', summary: 'DB query latency spiking, possible missing index after migration 0043.' },
    { title: 'Notification service — Email delivery delays', service: 'notification-service', severity: 3, status: 'open', source_type: 'prometheus', summary: 'SendGrid rate limiting causing 5-10 min delivery delays on transactional emails.' },
    { title: 'Inventory API — 200ms latency increase', service: 'inventory-api', severity: 4, status: 'resolved', source_type: 'datadog', summary: 'Elevated latency traced to cold cache after deployment. Self-resolved after warm-up.' },
  ];

  for (const s of samples) {
    const inc = await db.query(
      `INSERT INTO incidents (org_id, source_id, title, service, severity, status, source_type, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [orgId, srcId, s.title, s.service, s.severity, s.status, s.source_type, s.summary]
    );
    const incId = inc.rows[0].id;

    // Seed timeline events
    await db.query(
      `INSERT INTO incident_events (incident_id, actor, event_type, message)
       VALUES ($1, 'ai', 'alert_received', $2)`,
      [incId, `Alert received from ${s.source_type}: ${s.summary.slice(0, 100)}`]
    );
    if (s.status !== 'open') {
      await db.query(
        `INSERT INTO incident_events (incident_id, actor, event_type, message)
         VALUES ($1, 'demo@acme.com', 'comment', 'Investigating the issue now.')`,
        [incId]
      );
    }
    if (s.status === 'resolved') {
      await db.query(
        `UPDATE incidents SET resolved_at = NOW() - INTERVAL '25 minutes' WHERE id = $1`,
        [incId]
      );
      await db.query(
        `INSERT INTO incident_events (incident_id, actor, event_type, message)
         VALUES ($1, 'demo@acme.com', 'status_change', 'Incident resolved. Cache warmed up after ~20 min.')`,
        [incId]
      );
    }
  }

  console.log(`  Seeded ${samples.length} sample incidents`);
  console.log('\nDone! Start the server with:');
  console.log('  DATABASE_SSL=false DATABASE_URL=postgresql://ira_user:ira_local_pass@127.0.0.1/ira_db JWT_SECRET=dev-secret-change-in-prod PORT=3000 node src/saas/api/server.js');
  console.log('\nTest the API with:');
  console.log(`  curl -s -H "Authorization: Bearer ${rawKey}" http://localhost:3000/incidents | node -e "const d=require('fs').readFileSync(0,'utf8');const j=JSON.parse(d);j.incidents.forEach(i=>console.log(i.severity,i.status,i.title.slice(0,50)))"`);

  await db.close();
}

seed().catch(err => { console.error(err.message); process.exit(1); });
