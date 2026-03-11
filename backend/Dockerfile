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
COPY backend/config.js ./config.js
COPY backend/state.js ./state.js
COPY backend/evm.js ./evm.js
COPY backend/priceFeed.js ./priceFeed.js
COPY backend/physics.js ./physics.js
COPY backend/vrfManager.js ./vrfManager.js
COPY backend/betResolution.js ./betResolution.js
COPY backend/profileRoutes.js ./profileRoutes.js

# lib/ is required by server.js (profile-service, profile-db, vault-service)
COPY lib/server/ ./lib/server/

EXPOSE 3001

CMD ["node", "server.js"]
