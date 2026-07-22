import { Router } from 'express';
import { requireUser } from '../middleware/requireUser.js';

const router = Router();

const PRO_STATUSES = new Set(['active', 'trialing']);

router.get('/', requireUser, (req, res) => {
  const u = req.dbUser;
  res.json({
    id: u.id,
    email: u.email,
    isPro: PRO_STATUSES.has(u.subscriptionStatus),
    subscriptionStatus: u.subscriptionStatus,
    currentPeriodEnd: u.currentPeriodEnd,
  });
});

export default router;
