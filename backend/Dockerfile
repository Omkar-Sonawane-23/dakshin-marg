FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8200
CMD ["node", "--loader", "tsx", "src/server.ts"]
