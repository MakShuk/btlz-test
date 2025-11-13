import { SheetsWriter } from './sheets-writer.js';
import { TariffFormatter } from '../utils/tariff-formatter.js';
import { TariffService } from './tariff-service.js';
import { WarehouseService } from './warehouse-service.js';
import { SpreadsheetService } from './spreadsheet-service.js';
import { SpreadsheetSyncResult } from '../types/wildberries.js';
import { getServiceLogger } from '../utils/logger.js';
import { getGoogleSheetsConfigInstance } from '#config/google-sheets.js';

/**
 * Результат синхронизации всех таблиц
 */
export interface SheetsSyncResult {
  success: boolean;
  totalSpreadsheets: number;
  successfulSyncs: number;
  failedSyncs: number;
  totalRowsWritten: number;
  errors: string[];
  duration: number;
  spreadsheetResults: SpreadsheetSyncResult[];
}

/**
 * SheetsSyncService - Координатор синхронизации данных тарифов в Google Sheets
 *
 * Реализует полную логику синхронизации:
 * 1. Получение активных таблиц из базы данных
 * 2. Загрузка тарифов и складов из базы
 * 3. Форматирование данных для Google Sheets
 * 4. Очистка листов и запись новых данных
 * 5. Обновление времени последней синхронизации
 * 6. Обработка ошибок с продолжением работы для других таблиц
 */
export class SheetsSyncService {
  private sheetsWriter: SheetsWriter;
  private tariffService: TariffService;
  private warehouseService: WarehouseService;
  private spreadsheetService: SpreadsheetService;
  private config = getGoogleSheetsConfigInstance();
  private logger = getServiceLogger('SheetsSyncService');

  constructor(
    sheetsWriter?: SheetsWriter,
    tariffService?: TariffService,
    warehouseService?: WarehouseService,
    spreadsheetService?: SpreadsheetService
  ) {
    this.sheetsWriter = sheetsWriter || SheetsWriter.getInstance();
    this.tariffService = tariffService || new TariffService();
    this.warehouseService = warehouseService || new WarehouseService();
    this.spreadsheetService = spreadsheetService || new SpreadsheetService();
  }

  /**
   * Синхронизация всех активных таблиц
   *
   * @param date - Дата тарифов для синхронизации (опционально, текущая дата по умолчанию)
   * @returns Promise<SheetsSyncResult> - результат синхронизации
   */
  async syncAllSpreadsheets(date?: string): Promise<SheetsSyncResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const spreadsheetResults: SpreadsheetSyncResult[] = [];
    let totalRowsWritten = 0;
    let successfulSyncs = 0;
    let failedSyncs = 0;

    // Используем переданную дату или текущую
    const syncDate = date || this.getCurrentDateInMoscow();
    this.logger.info('Начало синхронизации всех таблиц', { date: syncDate });

    try {
      // 1. Получаем все активные таблицы
      const activeSpreadsheets = await this.spreadsheetService.getActive();
      const totalSpreadsheets = activeSpreadsheets.length;

      if (totalSpreadsheets === 0) {
        this.logger.warn('Нет активных таблиц для синхронизации');
        return {
          success: true,
          totalSpreadsheets: 0,
          successfulSyncs: 0,
          failedSyncs: 0,
          totalRowsWritten: 0,
          errors: [],
          duration: Date.now() - startTime,
          spreadsheetResults: []
        };
      }

      this.logger.info('Найдено активных таблиц', { count: totalSpreadsheets });

      // 2. Получаем данные тарифов и складов
      const { tariffs, warehouses } = await this.getTariffsAndWarehouses(syncDate);

      if (tariffs.length === 0) {
        this.logger.warn('Нет тарифов для синхронизации', { date: syncDate });
        return {
          success: true,
          totalSpreadsheets,
          successfulSyncs: 0,
          failedSyncs: 0,
          totalRowsWritten: 0,
          errors: ['Нет тарифов для синхронизации'],
          duration: Date.now() - startTime,
          spreadsheetResults: []
        };
      }

      // 3. Форматируем данные для Google Sheets
      const stocksCoefsData = TariffFormatter.prepareStocksCoefs(tariffs, warehouses);
      this.logger.info('Данные отформатированы', {
        tariffsCount: tariffs.length,
        warehousesCount: warehouses.length,
        rowsCount: stocksCoefsData.totalRows
      });

      // 4. Синхронизируем каждую таблицу
      for (const spreadsheet of activeSpreadsheets) {
        try {
          const result = await this.syncSingleSpreadsheet(
            spreadsheet.spreadsheet_id,
            spreadsheet.sheet_name,
            stocksCoefsData
          );

          spreadsheetResults.push(result);

          if (result.success) {
            successfulSyncs++;
            totalRowsWritten += result.rows_written || 0;

            // Обновляем время последней синхронизации в БД
            await this.spreadsheetService.updateLastSynced(
              spreadsheet.spreadsheet_id,
              spreadsheet.sheet_name,
              result
            );
          } else {
            failedSyncs++;
            errors.push(`Ошибка синхронизации таблицы ${spreadsheet.spreadsheet_id}:${spreadsheet.sheet_name} - ${result.error}`);
          }
        } catch (error) {
          failedSyncs++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push(`Критическая ошибка при синхронизации таблицы ${spreadsheet.spreadsheet_id}:${spreadsheet.sheet_name} - ${errorMessage}`);

          this.logger.error('Ошибка при синхронизации таблицы', {
            spreadsheet_id: spreadsheet.spreadsheet_id,
            sheet_name: spreadsheet.sheet_name,
            error: errorMessage
          });
        }
      }

      const duration = Date.now() - startTime;
      const success = failedSyncs === 0;

      this.logger.info('Синхронизация всех таблиц завершена', {
        totalSpreadsheets,
        successfulSyncs,
        failedSyncs,
        totalRowsWritten,
        duration,
        success
      });

      return {
        success,
        totalSpreadsheets,
        successfulSyncs,
        failedSyncs,
        totalRowsWritten,
        errors,
        duration,
        spreadsheetResults
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.logError(error as Error, 'Критическая ошибка при синхронизации', { date: syncDate, duration });
      errors.push(`Критическая ошибка синхронизации: ${errorMessage}`);

      return {
        success: false,
        totalSpreadsheets: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        totalRowsWritten: 0,
        errors,
        duration,
        spreadsheetResults
      };
    }
  }

  /**
   * Синхронизация одной таблицы
   *
   * @param spreadsheetId - ID таблицы
   * @param sheetName - имя листа
   * @param stocksCoefsData - подготовленные данные для листа stocks_coefs
   * @returns Promise<SpreadsheetSyncResult> - результат синхронизации
   */
  private async syncSingleSpreadsheet(
    spreadsheetId: string,
    sheetName: string,
    stocksCoefsData: {
      sheetName: string;
      headers: string[];
      data: any[][];
      totalRows: number;
    }
  ): Promise<SpreadsheetSyncResult> {
    const startTime = Date.now();
    const syncedAt = new Date();

    this.logger.info('Начало синхронизации таблицы', {
      spreadsheet_id: spreadsheetId,
      sheet_name: sheetName
    });

    try {
      // 1. Очищаем лист stocks_coefs
      const clearResult = await this.sheetsWriter.clear(spreadsheetId, `${stocksCoefsData.sheetName}!A:Z`);

      if (!clearResult.success) {
        throw new Error(`Ошибка очистки листа: ${clearResult.error}`);
      }

      // 2. Записываем заголовки
      const headersData = [stocksCoefsData.headers];
      const headersResult = await this.sheetsWriter.batchUpdate(
        spreadsheetId,
        headersData,
        `${stocksCoefsData.sheetName}!A1`
      );

      if (!headersResult.success) {
        throw new Error(`Ошибка записи заголовков: ${headersResult.error}`);
      }

      // 3. Записываем данные (если есть)
      let rowsWritten = 0;
      if (stocksCoefsData.data.length > 0) {
        const dataResult = await this.sheetsWriter.append(
          spreadsheetId,
          stocksCoefsData.data,
          `${stocksCoefsData.sheetName}!A2`
        );

        if (!dataResult.success) {
          throw new Error(`Ошибка записи данных: ${dataResult.error}`);
        }

        rowsWritten = dataResult.rowsCount || 0;
      }

      const duration = Date.now() - startTime;

      this.logger.info('Синхронизация таблицы завершена успешно', {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        rows_written: rowsWritten,
        duration
      });

      return {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        success: true,
        rows_written: rowsWritten,
        synced_at: syncedAt
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error('Ошибка при синхронизации таблицы', {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        error: errorMessage,
        duration
      });

      return {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        success: false,
        error: errorMessage,
        synced_at: syncedAt
      };
    }
  }

  /**
   * Получение тарифов и складов для указанной даты
   *
   * @param date - дата тарифов
   * @returns Promise<{tariffs: Tariff[], warehouses: Warehouse[]}>
   */
  private async getTariffsAndWarehouses(date: string): Promise<{
    tariffs: any[];
    warehouses: any[];
  }> {
    const endOperation = this.logger.startOperation('getTariffsAndWarehouses', { date });

    try {
      // Получаем тарифы за указанную дату
      const tariffs = await this.tariffService.getByDate(date);

      // Получаем все склады
      const warehouses = await this.warehouseService.getAll();

      this.logger.debug('Данные получены', {
        tariffsCount: tariffs.length,
        warehousesCount: warehouses.length,
        date
      });

      endOperation();
      return { tariffs, warehouses };
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Ошибка при получении тарифов и складов', { date });
      throw error;
    }
  }

  /**
   * Получение текущей даты в московском часовом поясе (UTC+3)
   * @returns строка в формате YYYY-MM-DD
   */
  private getCurrentDateInMoscow(): string {
    const now = new Date();
    // Получаем время в UTC+3 (Москва)
    const moscowTime = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    return moscowTime.toISOString().split('T')[0];
  }

  /**
   * Проверка доступности конфигурации Google Sheets
   *
   * @returns boolean - true если конфигурация валидна
   */
  isConfigurationValid(): boolean {
    try {
      return this.config.validate();
    } catch (error) {
      this.logger.error('Ошибка валидации конфигурации Google Sheets', { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }
}

// Экспорт экземпляра для использования в приложении
export const sheetsSyncService = new SheetsSyncService();

// Экспорт по умолчанию
export default SheetsSyncService;