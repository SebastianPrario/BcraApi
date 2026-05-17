# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Runtime stage
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache tini

COPY package.json package-lock.json ./
RUN npm ci --only=production && npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE 3001

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main"]
