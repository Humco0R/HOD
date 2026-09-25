FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/miniapp/package.json apps/miniapp/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/config/package.json packages/config/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY apps/miniapp apps/miniapp
COPY packages/contracts packages/contracts
RUN npm run build -w @hod/contracts && npm run build -w @hod/miniapp

FROM nginx:1.29-alpine
COPY infra/miniapp/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/miniapp/dist /usr/share/nginx/html
