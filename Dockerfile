# dradar2 — single image, used by both the `web` and `collector` services (see compose.yaml).
FROM node:24-alpine

WORKDIR /app

# Install the native image codec before copying application sources so dependency layers cache.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY schema.sql ./
COPY src/ ./src/
COPY scripts/ ./scripts/
# Fixtures ship in the image so the archive can be seeded for an offline demo in-container
# (`node scripts/seed-fixtures.js`).
COPY test/fixtures/ ./test/fixtures/

# archive.sqlite lives here; mount a volume at /data to persist it (compose does this).
ENV DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /app /data

# Run unprivileged.
USER node

EXPOSE 3210

# Default process is the read-only replay/history server. The collector service overrides
# this with `command: node src/collector.js`.
CMD ["node", "src/server.js"]
