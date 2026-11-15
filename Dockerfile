# Vitruvius Loom on Google Cloud Run: builds the site, then one Node server serves it and /api.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx vite build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production SERVE_STATIC=1 API_HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY src/content ./src/content
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "server/index.mjs"]
