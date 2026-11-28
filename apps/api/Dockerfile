FROM debian:trixie-slim@sha256:8aa5a7bf5a1955bddbe7d74fcdd0b91ab30e74362a8b73af672b0481b35b44a0 AS toolchain
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libstdc++6 libatomic1 wget \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json .node-version ./
COPY scripts/install-node.sh scripts/node-SHA256.txt scripts/npm-SHA512.txt ./scripts/
RUN sh scripts/install-node.sh /opt/node
ENV PATH="/opt/node/bin:${PATH}"

FROM toolchain AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages/shared packages/shared
COPY data/sources data/sources
COPY data/corrections data/corrections
RUN pnpm --filter @urd/api build

FROM toolchain
RUN groupadd --system app && useradd --system --gid app --create-home app
COPY --from=build --chown=app:app /app /app
USER app
ENV NODE_ENV=production
EXPOSE 3001
CMD ["sh", "-c", "pnpm --filter @urd/api db:migrate && pnpm --filter @urd/api start"]
