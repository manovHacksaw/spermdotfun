FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* yarn.lock* ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install

FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# IDL must exist for the server to load at runtime
COPY sprmfun-anchor/target/idl ./sprmfun-anchor/target/idl
ENV NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
ENV NEXT_PUBLIC_WS_URL=wss://backend.iameshan.tech/ws
ENV NEXT_PUBLIC_PUBNUB_PUBLISH_KEY=pub-c-8d53f729-bda6-47ba-8f91-f37e80130e03
ENV NEXT_PUBLIC_PUBNUB_SUBSCRIBE_KEY=sub-c-8c240887-543e-49a5-a003-a8dde30d8c8e
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy built Next.js output and server
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/sprmfun-anchor/target/idl ./sprmfun-anchor/target/idl
COPY --from=builder /app/next.config.js ./next.config.js

# Wallet keypair — mount at runtime via volume or secret, not baked in
# docker run -v /path/to/id.json:/app/wallet.json ...
# and set ANCHOR_WALLET=/app/wallet.json

EXPOSE 3000 3001

CMD ["npm", "start"]
