import express from 'express';
import cors from 'cors';
import { clerkMiddleware } from '@clerk/express';
import meRoutes from './routes/me.js';
import billingRoutes from './routes/billing.js';
import dataRoutes from './routes/data.js';
import stripeWebhookRouter from './routes/webhooksStripe.js';
import clerkWebhookRouter from './routes/webhooksClerk.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.FRONTEND_URL || true }));

  // Webhooks need the raw request body for signature verification — mount
  // them before express.json() touches the stream.
  app.use('/api/webhooks/stripe', stripeWebhookRouter);
  app.use('/api/webhooks/clerk', clerkWebhookRouter);

  // Liveness probe — must not depend on Clerk/DB being configured, since
  // hosting platforms hit this before/without any of that being ready.
  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // Higher than Express's 100kb default: the synced data blob can include
  // contact/profile photos as inline data URLs.
  app.use(express.json({ limit: '8mb' }));
  app.use(clerkMiddleware());

  app.use('/api/me', meRoutes);
  app.use('/api/billing', billingRoutes);
  app.use('/api/data', dataRoutes);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
