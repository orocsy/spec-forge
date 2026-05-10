# Multi-stage build for {{project.name}}.
# Pattern: a production NestJS Dockerfile.
#
# IMPORTANT: prisma/ schema is copied BEFORE `pnpm install` so the
# `postinstall` lifecycle (which runs `prisma generate`) can find it.
# Reordering the COPY lines below WILL break the build.

# ─── Build stage ────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# OpenSSL is required for Prisma's engine detection on Alpine.
RUN apk add --no-cache openssl libc6-compat \
 && corepack enable \
 && corepack prepare pnpm@9.15.0 --activate

# Copy lockfile + manifests first for max layer caching.
COPY package.json pnpm-lock.yaml* ./

# Copy prisma schema BEFORE install so postinstall (prisma generate) works.
# If your project doesn't use prisma, remove the next 3 lines.
COPY prisma ./prisma

# Frozen-lockfile install — fails fast if lockfile is out of sync.
RUN pnpm install --frozen-lockfile

# Copy the rest of the source.
COPY . .

# Build (runs the project's `build` script — `next build` for Next.js).
RUN pnpm build

# ─── Production stage ───────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache openssl libc6-compat

# Non-root user (standard non-root user pattern (uid 1001)).
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Copy the standalone Next build output (configure `output: 'standalone'`
# in next.config.mjs to enable; otherwise this falls through to the
# default copy below).
#
# Standalone mode (recommended for production):
# next.config.mjs:
# export default { output: 'standalone' };
#
# Then uncomment these COPY lines and DELETE the fallback below:
# COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Fallback (works without standalone mode but ships node_modules):
COPY --from=builder --chown=nextjs:nodejs /app ./

USER nextjs

EXPOSE 3000

# Healthcheck — adjust the URL to your health route.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
 CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

CMD ["pnpm", "start"]
