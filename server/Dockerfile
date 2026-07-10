FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV DB_PATH=/app/data/merge-arena.sqlite
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", "src/index.js"]
