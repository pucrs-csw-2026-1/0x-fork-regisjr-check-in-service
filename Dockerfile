FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# --legacy-peer-deps: @nestjs/testing@11 vs @nestjs/common@10 (skew pré-existente)
RUN npm ci --legacy-peer-deps
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
