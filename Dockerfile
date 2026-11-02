# syntax=docker/dockerfile:1
# 22earn — production image (Next.js standalone output, ~200 MB)

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/scripts/migrate-prod.mjs ./scripts/migrate-prod.mjs
# full packages needed by the migration runner (the standalone trace only keeps what the app imports)
COPY --from=build --chown=app:app /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=build --chown=app:app /app/node_modules/postgres ./node_modules/postgres
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
# migrate, then serve
CMD ["sh", "-c", "node scripts/migrate-prod.mjs && exec node server.js"]
