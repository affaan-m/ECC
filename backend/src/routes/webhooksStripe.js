import { Router, raw } from 'express';
import Stripe from 'stripe';
import { prisma } from '../db.js';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe signature verification needs the exact raw request bytes, so this
// route must be mounted before the app's global express.json() middleware.
router.post('/', raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[stripe webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const obj = event.data.object;
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        await prisma.user.updateMany({
          where: { stripeCustomerId: obj.customer },
          data: {
            stripeSubscriptionId: obj.id,
            subscriptionStatus: obj.status,
            subscriptionPriceId: obj.items?.data?.[0]?.price?.id ?? null,
            currentPeriodEnd: obj.current_period_end
              ? new Date(obj.current_period_end * 1000)
              : null,
          },
        });
        break;
      }
      case 'customer.subscription.deleted': {
        await prisma.user.updateMany({
          where: { stripeCustomerId: obj.customer },
          data: { subscriptionStatus: 'canceled' },
        });
        break;
      }
      default:
        break; // ignore events we don't care about
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[stripe webhook] handler error:', err);
    res.status(500).send('Webhook handler error');
  }
});

export default router;
