# Build context must be the repo root:
#   docker build -f backend/Dockerfile -t sprmfun-backend .

FROM node:24-slim AS deps
WORKDIR /app
COPY backend/package.json ./
RUN npm install

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY backend/package.json ./package.json
COPY backend/server.js ./server.js

# lib/ is required by server.js (profile-service, profile-db, vault-service)
COPY lib/server/ ./lib/server/

EXPOSE 3001

CMD ["node", "server.js"]
