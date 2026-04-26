# syntax=docker/dockerfile:1.7
# =============================================================================
# Multi-stage Dockerfile for the Notes App.
#
# Stage 1: deps — install dependencies (cacheable layer).
# Stage 2: builder — build the standalone Next.js output.
# Stage 3: runner — minimal runtime image.
#
# `output: 'standalone'` (set in next.config.ts) means we only copy a small
# trace of node_modules into the runtime image.
#
# deploy-ops module agent: tune image size, add health probes, log forwarding.
# =============================================================================

# ----- deps --------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
# Use npm because lockfile-aware installs are most predictable across CI.
RUN npm ci --no-audit --no-fund

# ----- builder -----------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time public env defaults — overridden at runtime by Railway.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
RUN npm run build

# ----- runner ------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output and static assets.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

# Healthcheck hits /healthz (DB-free liveness).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --spider http://localhost:${PORT}/healthz || exit 1

CMD ["node", "server.js"]
