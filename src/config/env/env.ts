import dotenv from 'dotenv';
import { z } from 'zod';
import { getServiceLogger } from '#utils/logger.js';

// Загрузка переменных окружения из .env файла
dotenv.config();

const logger = getServiceLogger('EnvConfig');

// Схема для валидации JSON с учетными данными Google
const googleCredentialsSchema = z.object({
  type: z.string(),
  project_id: z.string(),
  private_key_id: z.string(),
  private_key: z.string(),
  client_email: z.string(),
  client_id: z.string(),
  auth_uri: z.string(),
  token_uri: z.string(),
  auth_provider_x509_cert_url: z.string(),
  client_x509_cert_url: z.string(),
});

// Схема для валидации переменных окружения
const envSchema = z.object({
  // PostgreSQL конфигурация
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_DB: z.string().default('postgres'),
  POSTGRES_USER: z.string().default('postgres'),
  POSTGRES_PASSWORD: z.string().default('postgres'),

  // Конфигурация приложения
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_PORT: z.coerce.number().default(5000),

  // Wildberries API конфигурация
  WB_API_TOKEN: z.string().min(1, 'WB_API_TOKEN обязателен'),
  WB_API_BASE_URL: z.string().url().default('https://common-api.wildberries.ru'),

  // Google Sheets конфигурация
  GOOGLE_CREDENTIALS_JSON: z.string()
    .transform((val, ctx) => {
      try {
        const parsed = JSON.parse(val);
        const result = googleCredentialsSchema.parse(parsed);
        return JSON.stringify(result);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'GOOGLE_CREDENTIALS_JSON должен быть валидным JSON с учетными данными сервисного аккаунта Google',
        });
        return z.NEVER;
      }
    }),
  GOOGLE_SHEET_IDS: z.string()
    .transform((val) => {
      return val.split(',').map(id => id.trim()).filter(id => id.length > 0);
    })
    .refine((ids) => ids.length > 0, {
      message: 'GOOGLE_SHEET_IDS должен содержать хотя бы один ID таблицы',
    }),
  DEFAULT_SHEET_NAME: z.string().min(1, 'DEFAULT_SHEET_NAME обязателен'),
  GOOGLE_APP_SCOPES: z.string()
    .transform((val) => {
      return val.split(',').map(scope => scope.trim()).filter(scope => scope.length > 0);
    })
    .default('https://www.googleapis.com/auth/spreadsheets'),

  // Настройки логирования
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOGS_DIR: z.string().default('./logs'),
  LOGS_TO_FILE: z.enum(['true', 'false']).transform(val => val === 'true').default('false'),
});

// Валидация переменных окружения
const envValidation = envSchema.safeParse(process.env);

if (!envValidation.success) {
  logger.error('Ошибка валидации переменных окружения', {
    errors: envValidation.error.issues,
  });

  // Формируем читаемое сообщение об ошибке
  const errorMessage = envValidation.error.issues
    .map(issue => `${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  throw new Error(`Ошибка конфигурации:\n${errorMessage}`);
}

// Экспорт валидированных переменных окружения
const env = envValidation.data;

// Дополнительная функция для получения учетных данных Google в виде объекта
export function getGoogleCredentials() {
  try {
    return JSON.parse(env.GOOGLE_CREDENTIALS_JSON);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Ошибка парсинга GOOGLE_CREDENTIALS_JSON', { error: errorMessage });
    throw new Error('Невозможно распарсить GOOGLE_CREDENTIALS_JSON');
  }
}

// Функция для получения конфигурации Google Sheets
export function getGoogleSheetsConfig() {
  return {
    credentials: getGoogleCredentials(),
    sheetIds: env.GOOGLE_SHEET_IDS,
    defaultSheetName: env.DEFAULT_SHEET_NAME,
    appScopes: env.GOOGLE_APP_SCOPES,
  };
}

// Экспорт всех переменных окружения
export default env;

// Экспорт типов для использования в других модулях
export type EnvConfig = z.infer<typeof envSchema>;
export type GoogleCredentials = z.infer<typeof googleCredentialsSchema>;
