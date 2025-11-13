import { z } from 'zod';
import { getGoogleSheetsConfig, getGoogleCredentials } from './env/env.js';
import { getServiceLogger } from '#utils/logger.js';

const logger = getServiceLogger('GoogleSheetsConfig');

// Схема для валидации конфигурации Google Sheets
const googleSheetsConfigSchema = z.object({
  credentials: z.object({
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
  }),
  sheetIds: z.array(z.string()).min(1, 'Должен быть указан хотя бы один ID таблицы'),
  defaultSheetName: z.string().min(1, 'Имя листа по умолчанию не может быть пустым'),
  appScopes: z.array(z.string()).min(1, 'Должен быть указан хотя бы один scope'),
});

// Тип для конфигурации Google Sheets
export type GoogleSheetsConfigType = z.infer<typeof googleSheetsConfigSchema>;

/**
 * Класс для работы с конфигурацией Google Sheets
 */
export class GoogleSheetsConfig {
  private static instance: GoogleSheetsConfig;
  private config: GoogleSheetsConfigType;

  private constructor() {
    try {
      // Получаем конфигурацию из переменных окружения
      const rawConfig = getGoogleSheetsConfig();

      // Валидируем конфигурацию
      this.config = googleSheetsConfigSchema.parse(rawConfig);

      logger.info('Конфигурация Google Sheets успешно загружена', {
        sheetIdsCount: this.config.sheetIds.length,
        defaultSheetName: this.config.defaultSheetName,
        scopesCount: this.config.appScopes.length,
        projectId: this.config.credentials.project_id,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Ошибка инициализации конфигурации Google Sheets', { error: errorMessage });
      throw new Error(`Не удалось инициализировать конфигурацию Google Sheets: ${errorMessage}`);
    }
  }

  /**
   * Получение singleton экземпляра конфигурации
   */
  public static getInstance(): GoogleSheetsConfig {
    if (!GoogleSheetsConfig.instance) {
      GoogleSheetsConfig.instance = new GoogleSheetsConfig();
    }
    return GoogleSheetsConfig.instance;
  }

  /**
   * Получение полной конфигурации
   */
  public getConfig(): GoogleSheetsConfigType {
    return { ...this.config };
  }

  /**
   * Получение учетных данных сервисного аккаунта
   */
  public getCredentials() {
    return { ...this.config.credentials };
  }

  /**
   * Получение списка ID таблиц
   */
  public getSheetIds(): string[] {
    return [...this.config.sheetIds];
  }

  /**
   * Получение имени листа по умолчанию
   */
  public getDefaultSheetName(): string {
    return this.config.defaultSheetName;
  }

  /**
   * Получение списка scopes для Google API
   */
  public getAppScopes(): string[] {
    return [...this.config.appScopes];
  }

  /**
   * Получение email сервисного аккаунта
   */
  public getServiceAccountEmail(): string {
    return this.config.credentials.client_email;
  }

  /**
   * Получение ID проекта Google Cloud
   */
  public getProjectId(): string {
    return this.config.credentials.project_id;
  }

  /**
   * Проверка, что ID таблицы есть в конфигурации
   */
  public hasSheetId(sheetId: string): boolean {
    return this.config.sheetIds.includes(sheetId);
  }

  /**
   * Валидация конфигурации (может быть использована для проверки во время выполнения)
   */
  public validate(): boolean {
    try {
      googleSheetsConfigSchema.parse(this.config);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Ошибка валидации конфигурации Google Sheets', { error: errorMessage });
      return false;
    }
  }
}

// Экспорт функций для удобного доступа к конфигурации
export function getGoogleSheetsConfigInstance(): GoogleSheetsConfig {
  return GoogleSheetsConfig.getInstance();
}

export function getGoogleSheetsSettings(): GoogleSheetsConfigType {
  return getGoogleSheetsConfigInstance().getConfig();
}

export function getGoogleSheetsCredentials() {
  return getGoogleSheetsConfigInstance().getCredentials();
}

// Экспорт по умолчанию для совместимости
export default getGoogleSheetsConfigInstance;