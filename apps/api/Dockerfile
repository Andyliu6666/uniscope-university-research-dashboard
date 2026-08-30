FROM node:26-alpine AS build
RUN npm install --global npm@12.0.2 pnpm@11.24.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages/shared packages/shared
COPY data/sources data/sources
RUN pnpm --filter @urd/api build

FROM node:26-alpine
RUN npm install --global npm@12.0.2 pnpm@11.24.0 \
  && addgroup -S app \
  && adduser -S app -G app
WORKDIR /app
COPY --from=build /app /app
RUN chown -R app:app /app
USER app
ENV NODE_ENV=production
EXPOSE 3001
CMD ["sh", "-c", "pnpm --filter @urd/api db:migrate && pnpm --filter @urd/api start"]
