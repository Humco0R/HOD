FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/miniapp/package.json apps/miniapp/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/config/package.json packages/config/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY apps/backend apps/backend
COPY packages/contracts packages/contracts
COPY packages/config packages/config
RUN npm run build -w @hod/contracts \
  && npm run build -w @hod/config \
  && npm run build -w @hod/backend

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/apps/backend/drizzle ./apps/backend/drizzle
COPY --from=build /app/apps/backend/package.json ./apps/backend/package.json
RUN mkdir -p /data/proofs
ENTRYPOINT ["sh", "-c", "chown -R node:node /data/proofs && exec setpriv --reuid=node --regid=node --init-groups \"$@\"", "--"]
CMD ["node", "apps/backend/dist/server.js"]
