export const createFixedWindowRateLimiter = ({
  limit,
  windowMs,
  now = () => Date.now(),
}) => {
  const buckets = new Map()

  return (key) => {
    const timestamp = now()
    const current = buckets.get(key)
    if (!current || current.resetAt <= timestamp) {
      buckets.set(key, { count: 1, resetAt: timestamp + windowMs })
      return { allowed: true, retryAfterMs: 0 }
    }
    if (current.count >= limit) {
      return { allowed: false, retryAfterMs: Math.max(1, current.resetAt - timestamp) }
    }
    current.count += 1
    return { allowed: true, retryAfterMs: 0 }
  }
}
