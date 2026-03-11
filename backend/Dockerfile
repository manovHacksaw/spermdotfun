# Build context is the backend/ directory itself:
#   docker build -t sprmfun-backend ./backend

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY config.js ./
COPY state.js ./
COPY evm.js ./
COPY priceFeed.js ./
COPY physics.js ./
COPY vrfManager.js ./
COPY betResolution.js ./
COPY profileRoutes.js ./
COPY lib/ ./lib/

EXPOSE 3001

CMD ["node", "server.js"]
