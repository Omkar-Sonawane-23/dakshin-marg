FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY package*.json ./
RUN npm ci --omit=dev 2>/dev/null; npm install -g serve 2>/dev/null || true
EXPOSE 4173
CMD ["npx", "serve", "-s", "dist", "-l", "4173"]
