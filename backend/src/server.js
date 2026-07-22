import 'dotenv/config';
import { createApp } from './app.js';

const REQUIRED_ENV = [
  'DATABASE_URL',
  'CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'CLERK_WEBHOOK_SIGNING_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_ID',
  'FRONTEND_URL',
];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.warn(`[server] Missing env vars (some routes will fail until set): ${missing.join(', ')}`);
}

const app = createApp();
const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`Keystone backend listening on :${port}`);
});
