/**
 * Singleton Prisma client.
 *
 * In dev with HMR, Next.js / vitest can reload modules and re-instantiate
 * PrismaClient many times — exhausting the database connection pool. The
 * `globalThis` cache prevents that.
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
