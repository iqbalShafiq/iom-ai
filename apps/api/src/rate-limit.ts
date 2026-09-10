import type { Context, Next } from "hono";

interface Bucket {
  count: number;
  resetsAt: number;
}

export function rateLimit(options: { limit: number; windowMs: number; keyPrefix: string }) {
  const buckets = new Map<string, Bucket>();
  return async (context: Context, next: Next) => {
    const forwarded = context.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    const key = `${options.keyPrefix}:${forwarded ?? "local"}`;
    const now = Date.now();
    const current = buckets.get(key);
    const bucket =
      !current || current.resetsAt <= now
        ? { count: 0, resetsAt: now + options.windowMs }
        : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    context.header("RateLimit-Limit", String(options.limit));
    context.header("RateLimit-Remaining", String(Math.max(0, options.limit - bucket.count)));
    if (bucket.count > options.limit)
      return context.json({ error: "Terlalu banyak permintaan. Coba lagi nanti." }, 429);
    await next();
  };
}
