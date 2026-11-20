FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && mkdir -p /app/media && chown node:node /app/media
COPY *.js ./
USER node
ENV NODE_ENV=production MEDIA_DIR=/app/media
EXPOSE 8080
CMD ["node", "server.js"]
