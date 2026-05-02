FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci

COPY backend/ ./

RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

CMD ["npm", "start"]
