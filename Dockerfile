FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=cap_build_ca \
    if [ -f /run/secrets/cap_build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/cap_build_ca; fi; \
    npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    CAP_AUTH_ENABLED=1 \
    CAP_DATA_DIR=/data
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=secret,id=cap_build_ca \
    if [ -f /run/secrets/cap_build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/cap_build_ca; fi; \
    npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force \
    && mkdir -p /data \
    && chown -R node:node /app /data \
    && chmod 700 /data
COPY --chown=node:node server ./server
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3001
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3001/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
