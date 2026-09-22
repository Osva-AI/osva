# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json eslint.config.js vitest.config.ts ./
COPY apps ./apps
COPY packages ./packages
COPY adapters ./adapters

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM build AS production

ENV NODE_ENV=production

RUN pnpm prune --prod \
  && rm -rf .turbo \
  && rm -f eslint.config.js vitest.config.ts turbo.json \
  && find apps packages adapters -type d -name src -exec rm -rf {} +

FROM node:24-bookworm-slim AS runtime

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_ENV=production

RUN mkdir -p /var/lib/osva/trusted-runtime /var/lib/osva/artifacts \
  && chown -R node:node /var/lib/osva

WORKDIR /app

COPY --from=production --chown=node:node /app /app

COPY deploy/docker/entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh

USER node

ENV OSVA_TRUSTED_RUNTIME_ROOT=/var/lib/osva/trusted-runtime \
    OSVA_ARTIFACT_FILESYSTEM_ROOT=/var/lib/osva/artifacts

ENTRYPOINT ["/entrypoint.sh"]
CMD ["web"]
