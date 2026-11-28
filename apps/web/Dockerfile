FROM debian:testing-slim@sha256:501494a9e260de3e9e8989acab51064bbf4235f10cca22957df12d89f3023e12 AS toolchain
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libstdc++6 libatomic1 wget \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json .node-version ./
COPY scripts/install-node.sh scripts/node-SHA256.txt scripts/npm-SHA512.txt ./scripts/
RUN sh scripts/install-node.sh /opt/node
ENV PATH="/opt/node/bin:${PATH}"

FROM toolchain AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY vendor/previews/ vendor/previews/
COPY packages/biome-preview packages/biome-preview
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
COPY packages/shared packages/shared
RUN pnpm --filter @urd/web build

FROM nginx:1.31.10-alpine@sha256:7fc0fb4af7bf006aeb31aea88069976060f8f0a0a86b667126742cc17f4e31ae
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
