# ---- Build ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- Runtime ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/lib/operations.ts ./lib/operations.ts
COPY --from=builder /app/lib/operations-tools.ts ./lib/operations-tools.ts
COPY --from=builder /app/scripts/operations-token.mjs ./scripts/operations-token.mjs
COPY --from=builder /app/lib/customer-workflow.ts ./lib/customer-workflow.ts
COPY --from=builder /app/lib/customer-delivery.ts ./lib/customer-delivery.ts
COPY --from=builder /app/scripts/customer-workflow-worker.mjs ./scripts/customer-workflow-worker.mjs

# Datenbank, Uploads und Session-Secret landen in /app/data (als Volume mounten!)
VOLUME /app/data
EXPOSE 3000
CMD ["node", "server.js"]
