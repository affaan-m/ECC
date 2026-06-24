'use strict';

/**
 * Stripe Billing Service
 *
 * Handles subscription management, plan gating, and usage tracking.
 * Uses Stripe's REST API directly (no SDK) to keep zero production deps.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY         — sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET     — whsec_... (for webhook signature verification)
 *
 * Plan limits (enforced via planGate middleware):
 *   starter  — 1 alert source, 100 incidents/month, no AI diagnosis
 *   team     — 10 alert sources, unlimited incidents, AI diagnosis
 *   enterprise — unlimited everything, SSO, audit export
 */

const https = require('https');
const crypto = require('crypto');
const db = require('../db/client');

const STRIPE_API = 'api.stripe.com';
const STRIPE_KEY = () => {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not set');
  return process.env.STRIPE_SECRET_KEY;
};

const PLAN_LIMITS = {
  starter:    { alert_sources: 1,   incidents_per_month: 100,  ai_diagnosis: false, postmortems: false },
  team:       { alert_sources: 10,  incidents_per_month: null, ai_diagnosis: true,  postmortems: true  },
  enterprise: { alert_sources: null, incidents_per_month: null, ai_diagnosis: true,  postmortems: true  },
};

// Stripe Price IDs — set these to your actual Stripe price IDs
const PRICE_IDS = {
  team:       process.env.STRIPE_PRICE_TEAM       || 'price_team_monthly',
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE || 'price_enterprise_monthly',
};

// ─── Stripe HTTP helper ───────────────────────────────────────────────────────

function stripeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const key = STRIPE_KEY();
    const payload = body ? new URLSearchParams(flattenStripeParams(body)).toString() : '';

    const options = {
      hostname: STRIPE_API,
      port: 443,
      path,
      method,
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
        'Stripe-Version': '2024-06-20',
        'User-Agent': 'IncidentResponse-SaaS/1.0',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(parsed.error?.message || `Stripe HTTP ${res.statusCode}`));
          else resolve(parsed);
        } catch {
          reject(new Error('Invalid Stripe response'));
        }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Stripe request timeout')); });
    req.on('error', reject);
    req.setTimeout(10000);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Flatten nested object to Stripe's dot-notation param format.
 * e.g. { metadata: { org_id: 'x' } } → { 'metadata[org_id]': 'x' }
 */
function flattenStripeParams(obj, prefix = '') {
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(result, flattenStripeParams(val, fullKey));
    } else if (val !== null && val !== undefined) {
      result[fullKey] = String(val);
    }
  }
  return result;
}

// ─── Customer Management ──────────────────────────────────────────────────────

/**
 * Create or retrieve a Stripe customer for an org.
 */
async function getOrCreateCustomer(orgId, email, orgName) {
  const org = await db.query('SELECT stripe_customer_id FROM organizations WHERE id = $1', [orgId]);
  const existing = org.rows[0]?.stripe_customer_id;

  if (existing) return existing;

  const customer = await stripeRequest('POST', '/v1/customers', {
    email,
    name: orgName,
    metadata: { org_id: orgId },
  });

  await db.query(
    'UPDATE organizations SET stripe_customer_id = $1 WHERE id = $2',
    [customer.id, orgId]
  );

  return customer.id;
}

// ─── Subscription Management ──────────────────────────────────────────────────

/**
 * Create a Stripe checkout session for upgrading to a paid plan.
 * Returns the checkout URL — redirect the user there.
 */
async function createCheckoutSession(orgId, plan, userEmail, orgName, successUrl, cancelUrl) {
  const priceId = PRICE_IDS[plan];
  if (!priceId) throw new Error(`Unknown plan: ${plan}`);

  const customerId = await getOrCreateCustomer(orgId, userEmail, orgName);

  const session = await stripeRequest('POST', '/v1/checkout/sessions', {
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { org_id: orgId, plan },
    subscription_data: { metadata: { org_id: orgId, plan } },
    billing_address_collection: 'required',
    allow_promotion_codes: true,
  });

  return { url: session.url, session_id: session.id };
}

/**
 * Create a Stripe billing portal session so users can manage their subscription.
 */
async function createPortalSession(orgId, returnUrl) {
  const org = await db.query('SELECT stripe_customer_id FROM organizations WHERE id = $1', [orgId]);
  const customerId = org.rows[0]?.stripe_customer_id;
  if (!customerId) throw new Error('No Stripe customer found for this org');

  const session = await stripeRequest('POST', '/v1/billing_portal/sessions', {
    customer: customerId,
    return_url: returnUrl,
  });

  return { url: session.url };
}

// ─── Webhook Handling ─────────────────────────────────────────────────────────

/**
 * Verify Stripe webhook signature and return the event.
 * Prevents spoofed webhooks from updating subscription state.
 */
function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not set');

  const parts = signature.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});

  const timestamp = parts.t;
  const sig = parts.v1;

  if (!timestamp || !sig) throw new Error('Invalid Stripe signature format');

  // Reject events older than 5 minutes (replay attack prevention)
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (age > 300) throw new Error('Stripe webhook timestamp too old');

  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
    throw new Error('Stripe webhook signature mismatch');
  }

  return JSON.parse(rawBody);
}

/**
 * Handle Stripe webhook events to keep org plan in sync.
 */
async function handleWebhookEvent(event) {
  const { type, data } = event;

  switch (type) {
    case 'checkout.session.completed': {
      const session = data.object;
      const orgId = session.metadata?.org_id;
      const plan  = session.metadata?.plan;
      if (orgId && plan && PLAN_LIMITS[plan]) {
        await db.query('UPDATE organizations SET plan = $1 WHERE id = $2', [plan, orgId]);
        await db.query(
          `INSERT INTO audit_log (org_id, action, resource_type, resource_id, metadata)
           VALUES ($1, 'billing.plan_upgraded', 'organization', $1, $2)`,
          [orgId, JSON.stringify({ plan, session_id: session.id })]
        );
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = data.object;
      const orgId = sub.metadata?.org_id;
      if (orgId) {
        await db.query("UPDATE organizations SET plan = 'starter' WHERE id = $1", [orgId]);
        await db.query(
          `INSERT INTO audit_log (org_id, action, resource_type, resource_id, metadata)
           VALUES ($1, 'billing.subscription_cancelled', 'organization', $1, $2)`,
          [orgId, JSON.stringify({ subscription_id: sub.id })]
        );
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = data.object;
      const orgId = sub.metadata?.org_id;
      if (orgId) {
        // Derive plan from price ID
        const priceId = sub.items?.data?.[0]?.price?.id;
        const plan = Object.entries(PRICE_IDS).find(([, p]) => p === priceId)?.[0];
        if (plan) {
          await db.query('UPDATE organizations SET plan = $1 WHERE id = $2', [plan, orgId]);
        }
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = data.object;
      const customerId = invoice.customer;
      if (customerId) {
        const org = await db.query('SELECT id FROM organizations WHERE stripe_customer_id = $1', [customerId]);
        if (org.rows[0]) {
          await db.query(
            `INSERT INTO audit_log (org_id, action, metadata)
             VALUES ($1, 'billing.payment_failed', $2)`,
            [org.rows[0].id, JSON.stringify({ invoice_id: invoice.id, amount: invoice.amount_due })]
          );
        }
      }
      break;
    }

    default:
      break;
  }
}

// ─── Plan Gating ──────────────────────────────────────────────────────────────

/**
 * Get plan limits for an org's current plan.
 */
function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
}

/**
 * Check whether an org can use a feature given their plan.
 * Returns { allowed: boolean, reason: string|null, upgrade_to: string|null }
 */
function checkFeatureAccess(plan, feature) {
  const limits = getPlanLimits(plan);

  if (feature === 'ai_diagnosis' && !limits.ai_diagnosis) {
    return { allowed: false, reason: 'AI diagnosis requires Team plan or higher', upgrade_to: 'team' };
  }
  if (feature === 'postmortems' && !limits.postmortems) {
    return { allowed: false, reason: 'Postmortems require Team plan or higher', upgrade_to: 'team' };
  }
  return { allowed: true, reason: null, upgrade_to: null };
}

/**
 * Check whether an org is within their monthly incident limit.
 * Returns { allowed: boolean, used: number, limit: number|null }
 */
async function checkIncidentLimit(orgId, plan) {
  const limits = getPlanLimits(plan);
  if (!limits.incidents_per_month) return { allowed: true, used: 0, limit: null };

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const result = await db.query(
    'SELECT COUNT(*) FROM incidents WHERE org_id = $1 AND created_at >= $2',
    [orgId, startOfMonth.toISOString()]
  );

  const used = parseInt(result.rows[0].count, 10);
  return {
    allowed: used < limits.incidents_per_month,
    used,
    limit: limits.incidents_per_month,
  };
}

/**
 * Check whether an org can add another alert source.
 */
async function checkAlertSourceLimit(orgId, plan) {
  const limits = getPlanLimits(plan);
  if (!limits.alert_sources) return { allowed: true, used: 0, limit: null };

  const result = await db.query(
    'SELECT COUNT(*) FROM alert_sources WHERE org_id = $1 AND active = TRUE',
    [orgId]
  );

  const used = parseInt(result.rows[0].count, 10);
  return {
    allowed: used < limits.alert_sources,
    used,
    limit: limits.alert_sources,
  };
}

module.exports = {
  createCheckoutSession,
  createPortalSession,
  verifyWebhookSignature,
  handleWebhookEvent,
  getPlanLimits,
  checkFeatureAccess,
  checkIncidentLimit,
  checkAlertSourceLimit,
};
