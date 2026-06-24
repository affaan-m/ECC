'use strict';

/**
 * Plan gating middleware.
 * Enforces Stripe plan limits on API routes.
 *
 * Usage:
 *   router.post('/incidents', requireAuth, planGate.incidents(), createIncident)
 *   router.post('/diagnose',  requireAuth, planGate.feature('ai_diagnosis'), diagnose)
 */

const { checkFeatureAccess, checkIncidentLimit, checkAlertSourceLimit } = require('../services/billing');

/**
 * Gate on a named feature flag (ai_diagnosis, postmortems).
 */
function feature(name) {
  return (req, res, next) => {
    const result = checkFeatureAccess(req.org.plan, name);
    if (!result.allowed) {
      return res.status(402).json({
        error: result.reason,
        upgrade_to: result.upgrade_to,
        upgrade_url: `/billing/checkout?plan=${result.upgrade_to}`,
      });
    }
    return next();
  };
}

/**
 * Gate on monthly incident creation limit.
 */
function incidents() {
  return async (req, res, next) => {
    try {
      const result = await checkIncidentLimit(req.org.id, req.org.plan);
      if (!result.allowed) {
        return res.status(402).json({
          error: `Monthly incident limit reached (${result.used}/${result.limit}). Upgrade to Team for unlimited incidents.`,
          used: result.used,
          limit: result.limit,
          upgrade_url: '/billing/checkout?plan=team',
        });
      }
      // Attach usage info to request for response headers
      req.usageIncidents = result;
      return next();
    } catch (err) {
      process.stderr.write(`[PlanGate] Incident limit check failed: ${err.message}\n`);
      return next(); // fail open — don't block on billing errors
    }
  };
}

/**
 * Gate on alert source count limit.
 */
function alertSources() {
  return async (req, res, next) => {
    try {
      const result = await checkAlertSourceLimit(req.org.id, req.org.plan);
      if (!result.allowed) {
        return res.status(402).json({
          error: `Alert source limit reached (${result.used}/${result.limit}). Upgrade to Team for more sources.`,
          used: result.used,
          limit: result.limit,
          upgrade_url: '/billing/checkout?plan=team',
        });
      }
      return next();
    } catch (err) {
      process.stderr.write(`[PlanGate] Alert source limit check failed: ${err.message}\n`);
      return next();
    }
  };
}

module.exports = { feature, incidents, alertSources };
