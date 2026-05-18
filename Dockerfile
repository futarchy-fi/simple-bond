# SimpleBond notification backend (API + chain-watcher worker, combined mode).
# Runs `backend/server.mjs`, which starts the HTTP API and the Gnosis event
# watcher in one process sharing a single SQLite DB under /app/data.
FROM node:20-bookworm-slim

# Build toolchain for better-sqlite3's native addon (falls back to source
# build if no prebuilt binary matches this platform).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies against the committed lockfile.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Application code (backend only — frontend ships to Netlify separately).
COPY backend ./backend

# SQLite DB lives here; mount a volume at /app/data to persist it.
RUN mkdir -p /app/data

EXPOSE 3200
CMD ["node", "backend/server.mjs"]
