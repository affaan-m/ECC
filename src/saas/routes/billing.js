'use strict';

/**
 * Billing routes
 *
 * GET  /billing/plans              — list plans and limits (public)
 * POST /billing/checkout           — create Stripe checkout session (auth)
 * POST /billing/portal             — create Stripe billing portal session (auth)
 * POST /billing/webhook            — Stripe webhook receiver (no auth, signature verified)
 * GET  /billing/usage              — current org usage stats (auth)
 */

const billing = require('../services/billing');
const { sanitizeText } = require('../services/incident-classifier');

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: 0,
    currency: 'USD',
    interval: 'month',
    limits: billing.getPlanLimits('starter'),
    features: [
      '1 alert source (Datadog, PagerDuty, etc.)',
      '100 incidents per month',
      'Slack notifications',
      '30-day incident history',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    price: 149,
    currency: 'USD',
    interval: 'month',
    limits: billing.getPlanLimits('team'),
    features: [
      '10 alert sources',
      'Unlimited incidents',
      'AI root cause diagnosis',
      'Automated postmortems',
      'GitHub rollback PR generation',
      'On-call escalation routing',
      'Runbook library',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: null,
    currency: 'USD',
    interval: 'month',
    limits: billing.getPlanLimits('enterprise'),
    features: [
      'Unlimited alert sources',
      'Unlimited incidents',
      'All Team features',
      'SSO / SAML',
      'Private deployment (VPC / on-prem)',
      'SOC2 / ISO27001 audit export',
      'SLA reporting dashboard',
      'Dedicated support',
    ],
  },
];

// ─── List Plans ───────────────────────────────────────────────────────────────

async function listPlans(req, res) {
  return res.json({ plans: PLANS });
}

// ─── Create Checkout Session ──────────────────────────────────────────────────

async function createCheckout(req, res) {
  const { plan } = req.body || {};
  if (!plan || !['team', 'enterprise'].includes(plan)) {
    return res.status(400).json({ error: 'plan must be "team" or "enterprise"' });
  }

  if (req.org.plan === plan) {
    return res.status(400).json({ error: `Already on ${plan} plan` });
  }

  const origin = req.headers.origin || req.headers.referer || 'http://localhost:5173';
  const safeOrigin = origin.startsWith('https://') || origin.startsWith('http://localhost')
    ? origin.replace(/\/$/, '')
    : 'http://localhost:5173';

  try {
    const session = await billing.createCheckoutSession(
      req.org.id,
      plan,
      req.user?.email || '',
      req.org.name,
      `${safeOrigin}/billing/success`,
      `${safeOrigin}/billing/cancel`
    );
    return res.json(session);
  } catch (err) {
    process.stderr.write(`[Billing] Checkout error: ${err.message}\n`);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}

// ─── Billing Portal ───────────────────────────────────────────────────────────

async function createPortal(req, res) {
  const origin = req.headers.origin || 'http://localhost:5173';
  const safeOrigin = origin.startsWith('https://') || origin.startsWith('http://localhost')
    ? origin.replace(/\/$/, '')
    : 'http://localhost:5173';

  try {
    const session = await billing.createPortalSession(req.org.id, `${safeOrigin}/settings/billing`);
    return res.json(session);
  } catch (err) {
    process.stderr.write(`[Billing] Portal error: ${err.message}\n`);
    return res.status(500).json({ error: 'Failed to create portal session' });
  }
}

// ─── Stripe Webhook ───────────────────────────────────────────────────────────

async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).json({ error: 'Missing Stripe signature' });

  // rawBody must be the unmodified body bytes — set by server before JSON parsing
  const rawBody = req.rawBody;
  if (!rawBody) return res.status(400).json({ error: 'Raw body not available' });

  let event;
  try {
    event = billing.verifyWebhookSignature(rawBody, sig);
  } catch (err) {
    process.stderr.write(`[Billing] Webhook signature failed: ${err.message}\n`);
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  try {
    await billing.handleWebhookEvent(event);
    return res.json({ received: true });
  } catch (err) {
    process.stderr.write(`[Billing] Webhook handler error: ${err.message}\n`);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

// ─── Usage Stats ──────────────────────────────────────────────────────────────

async function getUsage(req, res) {
  const [incLimit, srcLimit] = await Promise.all([
    billing.checkIncidentLimit(req.org.id, req.org.plan),
    billing.checkAlertSourceLimit(req.org.id, req.org.plan),
  ]);

  return res.json({
    plan: req.org.plan,
    limits: billing.getPlanLimits(req.org.plan),
    usage: {
      incidents_this_month: { used: incLimit.used, limit: incLimit.limit },
      alert_sources: { used: srcLimit.used, limit: srcLimit.limit },
    },
  });
}

module.exports = { listPlans, createCheckout, createPortal, handleStripeWebhook, getUsage };
