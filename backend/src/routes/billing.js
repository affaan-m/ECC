import { Router } from 'express';
import Stripe from 'stripe';
import { requireUser } from '../middleware/requireUser.js';
import { prisma } from '../db.js';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

// Starts a subscription purchase — redirect the browser to the returned URL.
router.post('/checkout', requireUser, async (req, res, next) => {
  try {
    const customerId = await ensureStripeCustomer(req.dbUser);
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/#/more?checkout=success`,
      cancel_url: `${process.env.FRONTEND_URL}/#/pricing?checkout=cancelled`,
    });
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// Opens Stripe's hosted "manage my subscription" page.
router.post('/portal', requireUser, async (req, res, next) => {
  try {
    if (!req.dbUser.stripeCustomerId) {
      return res.status(400).json({ error: 'No billing account yet — subscribe first.' });
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
