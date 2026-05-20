# syntax=docker/dockerfile:1.7

# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /build

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    API_HOST=0.0.0.0

RUN apk add --no-cache postgresql-client

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /build/dist ./dist
COPY --from=builder /build/server ./server
COPY --from=builder /build/scripts ./scripts
COPY --from=builder /build/src/data ./src/data
COPY --from=builder /build/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /build/tsconfig.json ./tsconfig.json
COPY --from=builder /build/server/tsconfig.json ./server/tsconfig.json

COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "start"]
