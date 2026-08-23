FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages/shared packages/shared
RUN pnpm --filter @urd/api build

FROM node:24-alpine
RUN corepack enable \
  && addgroup -S app \
  && adduser -S app -G app
WORKDIR /app
COPY --from=build /app /app
RUN chown -R app:app /app
USER app
ENV NODE_ENV=production
EXPOSE 3001
CMD ["sh", "-c", "pnpm --filter @urd/api db:migrate && pnpm --filter @urd/api start"]
