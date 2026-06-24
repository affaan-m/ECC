'use strict';

/**
 * Incident Classifier
 * Severity classification and text sanitization utilities.
 */

const SEV_RULES = [
  {
    level: 1,
    keywords: ['p1', 'sev1', 'critical', 'down', 'outage', 'unavailable',
               'data loss', 'corruption', 'payment', 'breach', 'incident'],
  },
  {
    level: 2,
    keywords: ['p2', 'sev2', 'high', 'degraded', 'latency', 'error rate',
               'auth fail', 'timeout', 'spike', 'elevated'],
  },
  {
    level: 3,
    keywords: ['p3', 'sev3', 'medium', 'warning', 'minor', 'slow'],
  },
  {
    level: 4,
    keywords: ['p4', 'sev4', 'low', 'info', 'cosmetic', 'logging'],
  },
];

/**
 * Classify alert text into a severity level (1-4).
 * Returns 3 (medium) as default when no keywords match.
 */
function classifySeverity(text) {
  const lower = (text || '').toLowerCase();
  for (const rule of SEV_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule.level;
    }
  }
  return 3;
}

/**
 * Sanitize user-provided text: strip control characters, limit length.
 * Never pass unsanitized external content to DB or notifications.
 */
function sanitizeText(text, maxLen = 500) {
  if (text === null || text === undefined) return '';
  const str = typeof text === 'string' ? text : String(text);
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ')
            .trim()
            .slice(0, maxLen);
}

const SEV_LABELS = { 1: 'SEV1 - CRITICAL', 2: 'SEV2 - HIGH', 3: 'SEV3 - MEDIUM', 4: 'SEV4 - LOW' };

function severityLabel(level) {
  return SEV_LABELS[level] || 'SEV3 - MEDIUM';
}

module.exports = { classifySeverity, sanitizeText, severityLabel };
