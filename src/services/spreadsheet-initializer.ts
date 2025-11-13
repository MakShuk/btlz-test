import { SpreadsheetService } from './spreadsheet-service.js';
import { getGoogleSheetsSettings } from '../config/google-sheets.js';
import { getServiceLogger } from '../utils/logger.js';
import { CreateSpreadsheetRequest } from '../types/wildberries.js';

/**
 * Сервис для автоматической инициализации таблиц из переменных окружения
 */
export class SpreadsheetInitializer {
  private logger = getServiceLogger('SpreadsheetInitializer');
  private spreadsheetService: SpreadsheetService;

  constructor() {
    this.spreadsheetService = new SpreadsheetService();
  }

  /**
   * Инициализация таблиц из переменной окружения GOOGLE_SHEET_IDS
   */
  async initializeSpreadsheets(): Promise<void> {
    const endOperation = this.logger.startOperation('initializeSpreadsheets');

    try {
      this.logger.info('Начало инициализации таблиц из переменных окружения');

      // Получаем настройки Google Sheets
      const googleSheetsSettings = getGoogleSheetsSettings();
      const sheetIds = googleSheetsSettings.sheetIds;
      const defaultSheetName = googleSheetsSettings.defaultSheetName;

      this.logger.info('Получены настройки из переменных окружения', {
        sheetIdsCount: sheetIds.length,
        defaultSheetName,
        sheetIds
      });

      // Проверяем каждую таблицу
      let createdCount = 0;
      let alreadyExistsCount = 0;
      let errorCount = 0;

      for (const sheetId of sheetIds) {
        try {
          // Проверяем наличие таблицы в базе данных
          const existingSpreadsheet = await this.spreadsheetService.getById(sheetId, defaultSheetName);

          if (existingSpreadsheet) {
            this.logger.debug('Таблица уже существует в базе данных', {
              spreadsheet_id: sheetId,
              sheet_name: defaultSheetName
            });
            alreadyExistsCount++;
            continue;
          }

          // Создаем новую таблицу
          const createRequest: CreateSpreadsheetRequest = {
            spreadsheet_id: sheetId,
            sheet_name: defaultSheetName,
            is_active: true,
            description: 'Автоматически созданная таблица'
          };

          const createdSpreadsheet = await this.spreadsheetService.create(createRequest);

          this.logger.info('Таблица успешно создана', {
            spreadsheet_id: createdSpreadsheet.spreadsheet_id,
            sheet_name: createdSpreadsheet.sheet_name,
            description: createdSpreadsheet.description,
            is_active: createdSpreadsheet.is_active
          });

          createdCount++;
        } catch (error) {
          errorCount++;
          this.logger.logError(error as Error, `Ошибка при обработке таблицы с ID ${sheetId}`, {
            spreadsheet_id: sheetId,
            sheet_name: defaultSheetName
          });
          // Продолжаем обработку других таблиц даже при ошибке
        }
      }

      this.logger.info('Инициализация таблиц завершена', {
        totalProcessed: sheetIds.length,
        created: createdCount,
        alreadyExists: alreadyExistsCount,
        errors: errorCount
      });

      endOperation();
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Критическая ошибка при инициализации таблиц');
      // Не прерываем запуск приложения, а только логируем ошибку
    }
  }

  /**
   * Проверка наличия всех необходимых таблиц
   * @returns Promise<boolean> - true если все таблицы на месте, иначе false
   */
  async checkSpreadsheets(): Promise<boolean> {
    const endOperation = this.logger.startOperation('checkSpreadsheets');

    try {
      const googleSheetsSettings = getGoogleSheetsSettings();
      const sheetIds = googleSheetsSettings.sheetIds;
      const defaultSheetName = googleSheetsSettings.defaultSheetName;

      let allExist = true;

      for (const sheetId of sheetIds) {
        const existingSpreadsheet = await this.spreadsheetService.getById(sheetId, defaultSheetName);

        if (!existingSpreadsheet) {
          this.logger.warn('Таблица отсутствует в базе данных', {
            spreadsheet_id: sheetId,
            sheet_name: defaultSheetName
          });
          allExist = false;
        }
      }

      this.logger.info(`Проверка наличия таблиц завершена: ${allExist ? 'все таблицы на месте' : 'некоторые таблицы отсутствуют'}`, {
        totalExpected: sheetIds.length,
        allExist
      });

      endOperation();
      return allExist;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Ошибка при проверке наличия таблиц');
      return false;
    }
  }

  /**
   * Получение статистики по инициализированным таблицам
   */
  async getInitializationStats(): Promise<{
    totalExpected: number;
    totalInDb: number;
    activeInDb: number;
    sheetIds: string[];
  }> {
    const endOperation = this.logger.startOperation('getInitializationStats');

    try {
      const googleSheetsSettings = getGoogleSheetsSettings();
      const sheetIds = googleSheetsSettings.sheetIds;
      const defaultSheetName = googleSheetsSettings.defaultSheetName;

      // Получаем все таблицы из базы данных
      const allSpreadsheets = await this.spreadsheetService.getAll();
      const activeSpreadsheets = await this.spreadsheetService.getActive();

      // Считаем таблицы, которые соответствуют нашим ID
      let totalInDb = 0;
      let activeInDb = 0;

      for (const sheetId of sheetIds) {
        const exists = allSpreadsheets.some(s => s.spreadsheet_id === sheetId && s.sheet_name === defaultSheetName);
        const isActive = activeSpreadsheets.some(s => s.spreadsheet_id === sheetId && s.sheet_name === defaultSheetName);

        if (exists) totalInDb++;
        if (isActive) activeInDb++;
      }

      const stats = {
        totalExpected: sheetIds.length,
        totalInDb,
        activeInDb,
        sheetIds
      };

      this.logger.info('Получена статистика по инициализированным таблицам', stats);

      endOperation();
      return stats;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Ошибка при получении статистики по таблицам');
      throw error;
    }
  }
}

// Экспорт экземпляра сервиса для использования в приложении
export const spreadsheetInitializer = new SpreadsheetInitializer();

// Экспорт по умолчанию для удобства
export default SpreadsheetInitializer;