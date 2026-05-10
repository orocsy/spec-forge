/**
 * Singleton Redis client (ioredis).
 *
 * Lazy-init: created on first call. Reused across HMR reloads via
 * globalThis cache to avoid leaking connections in dev.
 */
import IORedis, { type Redis } from 'ioredis';

const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

export function getRedis(): Redis {
  if (globalForRedis.redis) return globalForRedis.redis;

  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const client = new IORedis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });

  client.on('error', (err) => {
    console.error('[redis] error:', err.message);
  });

  if (process.env.NODE_ENV !== 'production') {
    globalForRedis.redis = client;
  }
  return client;
}

export const redis = getRedis;
