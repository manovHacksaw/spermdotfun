FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install

FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_AVALANCHE_RPC_URL
ARG NEXT_PUBLIC_CONTRACT_ADDRESS
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_AVALANCHE_RPC_URL=$NEXT_PUBLIC_AVALANCHE_RPC_URL
ENV NEXT_PUBLIC_CONTRACT_ADDRESS=$NEXT_PUBLIC_CONTRACT_ADDRESS
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/next.config.js ./next.config.js

EXPOSE 3000

CMD ["npm", "start"]
