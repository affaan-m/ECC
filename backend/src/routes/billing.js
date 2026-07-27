import { Router } from 'express';
import Stripe from 'stripe';
import { requireUser } from '../middleware/requireUser.js';
import { prisma } from '../db.js';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Pro is a single one-time purchase, so there is exactly one price and the
// client never sends a price ID — checkout can't be pointed at an arbitrary
// price in the account.
const LIFETIME_PRICE_ID = process.env.STRIPE_PRICE_ID_LIFETIME || process.env.STRIPE_PRICE_ID;

async function ensureStripeCustomer(user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe.customers.create({
    email: user.email,
    metadata: { clerkId: user.clerkId, userId: user.id },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

// Starts the one-time Pro purchase — redirect the browser to the returned URL.
router.post('/checkout', requireUser, async (req, res, next) => {
  try {
    if (!LIFETIME_PRICE_ID) {
      return res.status(400).json({ error: 'No Stripe price configured for Pro' });
    }
    // Already bought — don't let a double-tap or a stale tab charge twice.
    if (req.dbUser.lifetimePurchasedAt) {
      return res.status(400).json({ error: 'You already own Keystone Pro.' });
    }

    const customerId = await ensureStripeCustomer(req.dbUser);
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: [{ price: LIFETIME_PRICE_ID, quantity: 1 }],
      // So the webhook can identify the buyer even if the customer lookup
      // ever fails to match.
      client_reference_id: req.dbUser.id,
      metadata: { userId: req.dbUser.id, clerkId: req.dbUser.clerkId, kind: 'lifetime' },
      // One-time payments don't get an automatic invoice; ask for one so the
      // buyer has a receipt they can find later.
      invoice_creation: { enabled: true },
      success_url: `${process.env.FRONTEND_URL}/#/more?checkout=success`,
      cancel_url: `${process.env.FRONTEND_URL}/#/pricing?checkout=cancelled`,
    });
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// Opens Stripe's hosted billing page. Only meaningful for people who
// subscribed before Pro became a one-time purchase — it's how they cancel.
// New buyers have nothing recurring to manage and never see this.
router.post('/portal', requireUser, async (req, res, next) => {
  try {
    if (!req.dbUser.stripeCustomerId) {
      return res.status(400).json({ error: 'No billing account yet.' });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: req.dbUser.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/#/more`,
    });
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

export default router;
