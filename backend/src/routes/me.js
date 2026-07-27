import { Router } from 'express';
import { requireUser } from '../middleware/requireUser.js';

const router = Router();

const PRO_STATUSES = new Set(['active', 'trialing']);

router.get('/', requireUser, (req, res) => {
  const u = req.dbUser;
  // Pro is a one-time purchase now; an active legacy subscription still
  // counts, so nobody who paid before the switch loses access.
  const isLifetime = !!u.lifetimePurchasedAt;
  res.json({
    id: u.id,
    email: u.email,
    isPro: isLifetime || PRO_STATUSES.has(u.subscriptionStatus),
    isLifetime,
    lifetimePurchasedAt: u.lifetimePurchasedAt,
    // Only set for pre-switch subscribers — the frontend uses this to decide
    // whether to offer the "manage billing" escape hatch at all.
    subscriptionStatus: u.subscriptionStatus,
    currentPeriodEnd: u.currentPeriodEnd,
  });
});

export default router;
