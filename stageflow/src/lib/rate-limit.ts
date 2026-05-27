import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

/**
 * Rate limiter using Upstash Redis in production, with an
 * in-memory fallback for local development.
 *
 * The in-memory store resets on server restart, which is fine for dev.
 */

function createRedisClient(): Redis | undefined {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (url && token) {
    return new Redis({ url, token })
  }

  return undefined
}

const redis = createRedisClient()

/** In-memory store for local development when Redis is unavailable */
const memoryStore = new Map<string, { count: number; resetAt: number }>()

interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  reset: number
}

/**
 * In-memory rate limiter for local development.
 */
function memoryRateLimit(
  identifier: string,
  maxRequests: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now()
  const entry = memoryStore.get(identifier)

  if (!entry || now >= entry.resetAt) {
    memoryStore.set(identifier, { count: 1, resetAt: now + windowMs })
    return {
      success: true,
      limit: maxRequests,
      remaining: maxRequests - 1,
      reset: now + windowMs,
    }
  }

  entry.count += 1

  if (entry.count > maxRequests) {
    return {
      success: false,
      limit: maxRequests,
      remaining: 0,
      reset: entry.resetAt,
    }
  }

  return {
    success: true,
    limit: maxRequests,
    remaining: maxRequests - entry.count,
    reset: entry.resetAt,
  }
}

/**
 * Pre-configured rate limiters for different use cases.
 */

/** General API rate limit: 60 requests per minute */
const apiLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, '1 m'),
      analytics: true,
      prefix: 'ratelimit:api',
    })
  : null

/** Auth rate limit: 10 attempts per 15 minutes */
const authLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, '15 m'),
      analytics: true,
      prefix: 'ratelimit:auth',
    })
  : null

/** Upload rate limit: 20 uploads per hour */
const uploadLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, '1 h'),
      analytics: true,
      prefix: 'ratelimit:upload',
    })
  : null

export type RateLimitType = 'api' | 'auth' | 'upload'

/**
 * Check rate limit for a given identifier and type.
 *
 * @param identifier - Unique key for the rate-limited entity (e.g. user ID, IP address)
 * @param type - Which rate limit tier to apply
 */
export async function rateLimit(
  identifier: string,
  type: RateLimitType = 'api',
): Promise<RateLimitResult> {
  const config: Record<RateLimitType, { limiter: Ratelimit | null; max: number; windowMs: number }> = {
    api: { limiter: apiLimiter, max: 60, windowMs: 60_000 },
    auth: { limiter: authLimiter, max: 10, windowMs: 15 * 60_000 },
    upload: { limiter: uploadLimiter, max: 20, windowMs: 60 * 60_000 },
  }

  const { limiter, max, windowMs } = config[type]

  // Use Upstash if available
  if (limiter) {
    const result = await limiter.limit(identifier)
    return {
      success: result.success,
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
    }
  }

  // Fall back to in-memory
  return memoryRateLimit(`${type}:${identifier}`, max, windowMs)
}
