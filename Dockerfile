FROM node:20-alpine AS deps-build
WORKDIR /app

# Устанавливаем dev-зависимости отдельно для кэширования
COPY package*.json ./
RUN npm ci

FROM deps-build AS build
WORKDIR /app
COPY . .

# Собираем TypeScript в dist
RUN npm run build

FROM node:20-alpine AS deps-prod
WORKDIR /app
COPY package*.json ./

# Устанавливаем только prod-зависимости
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime

# Устанавливаем tini для корректной обработки сигналов в контейнере
RUN apk add --no-cache tini
ENV NODE_ENV=production
WORKDIR /app

# Создаем директорию для логов и устанавливаем права
RUN mkdir -p logs && chown -R node:node logs

# Копируем необходимые артефакты
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist/postgres ./dist/postgres
COPY --from=build /app/src/postgres ./src/postgres
# Убедимся, что CJS seed файлы доступны в контейнере
COPY --from=build /app/src/postgres/seeds/*.cjs ./dist/postgres/seeds/

# Безопасный пользователь
USER node

# Используем tini как init-процесс
ENTRYPOINT ["/sbin/tini","-g","--"]
CMD ["node","dist/app.js"]
