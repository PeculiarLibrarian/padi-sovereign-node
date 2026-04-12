# Stage 1: Build (The Foundry)
# Pinning to specific Alpine version for libc stability (G-03)
FROM node:20.18.1-alpine3.20 AS builder

# Install build essentials for native LevelDB modules
RUN apk add --no-cache python3 make g++ 
RUN npm install -g pnpm@9.0.0

WORKDIR /app

# Copy workspace metadata first to leverage Docker layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY apps/ ./apps/

# Install all dependencies and build the monorepo
RUN pnpm install --frozen-lockfile
RUN pnpm build

# Stage 2: Production (The Sovereign Vault)
FROM node:20.18.1-alpine3.20 AS runner

# G-05: Minimal runtime security & non-root user setup
RUN apk add --no-cache libstdc++ && \
    addgroup -S padi && adduser -S padi -G padi

WORKDIR /app
ENV NODE_ENV=production

# 🛡️ Strategic Copy: Move only what is necessary for execution
# We copy the root node_modules to preserve the pnpm workspace symlinks
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api-server/dist ./apps/api-server/dist
COPY --from=builder /app/apps/api-server/package.json ./apps/api-server/package.json

# Initialize persistence directory with correct permissions
RUN mkdir -p /app/data && chown -R padi:padi /app/data

# Apply Least Privilege (G-05)
USER padi

# Port 3000 for the API Perimeter
EXPOSE 3000

# Metadata & Persistence
VOLUME ["/app/data"]

# Deterministic Start Command
CMD ["node", "apps/api-server/dist/server.js"]
