import { WildberriesApiClient } from './wildberries-api.js';
import { WarehouseService } from './warehouse-service.js';
import { TariffService } from './tariff-service.js';
import { BoxTariffResponse, WarehouseData, BoxTariff, WarehouseWithTariffsData } from '../types/wildberries.js';
import knex from '#postgres/knex.js';
import { getServiceLogger } from '../utils/logger.js';
import { TariffTransformer } from '../utils/tariff-transformer.js';

/**
 * Результат обновления тарифов
 */
export interface TariffUpdateResult {
  success: boolean;
  date: string;
  warehousesProcessed: number;
  tariffsProcessed: number;
  errors: string[];
  duration: number; // в миллисекундах
}

/**
 * Статистика обработки одного склада
 */
interface WarehouseProcessingStats {
  warehouseName: string;
  warehouseId: number;
  tariffsCount: number;
}

/**
 * TariffsUpdater - Координатор процесса обновления тарифов
 *
 * Реализует бизнес-логику интеграции с Wildberries Box Tariffs API:
 * 1. Получение данных из API через WildberriesApiClient
 * 2. Валидация данных через Zod схемы
 * 3. Сохранение/обновление складов через WarehouseService
 * 4. Сохранение/обновление тарифов через TariffService
 * 5. Обработка ошибок и логирование результатов
 */
export class TariffsUpdater {
  private apiClient: WildberriesApiClient;
  private warehouseService: WarehouseService;
  private tariffService: TariffService;
  private logger = getServiceLogger('TariffsUpdater');

  constructor(
    apiClient?: WildberriesApiClient,
    warehouseService?: WarehouseService,
    tariffService?: TariffService
  ) {
    this.apiClient = apiClient || new WildberriesApiClient();
    this.warehouseService = warehouseService || new WarehouseService();
    this.tariffService = tariffService || new TariffService();
  }

  /**
   * Обновление тарифов за указанную дату
   *
   * @param date - Дата в формате YYYY-MM-DD
   * @returns Promise<TariffUpdateResult> - результат обновления
   *
   * @example
   * const updater = new TariffsUpdater();
   * const result = await updater.updateTariffsForDate('2025-11-12');
   * console.log(`Обработано складов: ${result.warehousesProcessed}`);
   */
  async updateTariffsForDate(date: string): Promise<TariffUpdateResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let warehousesProcessed = 0;
    let tariffsProcessed = 0;

    this.logger.info(`Начало обновления тарифов за ${date}`, { date });

    try {
      // 1. Получение данных из API
      this.logger.debug('Запрос данных из Wildberries API', { date });
      const apiResponse = await this.fetchTariffsFromApi(date);

      if (!apiResponse) {
        throw new Error('Не удалось получить данные из API');
      }

      // 2. Валидация данных (уже произошла в WildberriesApiClient через Zod)
      const { warehouseList, dtTillMax, dtNextBox } = apiResponse.response.data;
      this.logger.info('Данные получены из API', {
        date,
        warehousesCount: warehouseList.length,
        dtTillMax,
        dtNextBox
      });

      // 3. Транзакционное сохранение данных
      const processingResult = await this.processAndSaveData(
        warehouseList,
        date,
        dtTillMax,
        dtNextBox
      );

      warehousesProcessed = processingResult.warehousesProcessed;
      tariffsProcessed = processingResult.tariffsProcessed;
      errors.push(...processingResult.errors);

      const duration = Date.now() - startTime;
      const success = errors.length === 0;

      this.logger.info('Обновление завершено', {
        date,
        warehousesProcessed,
        tariffsProcessed,
        errorsCount: errors.length,
        duration,
        success
      });

      return {
        success,
        date,
        warehousesProcessed,
        tariffsProcessed,
        errors,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.logError(error as Error, 'Критическая ошибка при обновлении', { date, duration });
      errors.push(errorMessage);

      return {
        success: false,
        date,
        warehousesProcessed,
        tariffsProcessed,
        errors,
        duration,
      };
    }
  }

  /**
   * Обновление тарифов за текущую дату
   *
   * @returns Promise<TariffUpdateResult> - результат обновления
   *
   * @example
   * const updater = new TariffsUpdater();
   * const result = await updater.updateAllTariffs();
   */
  async updateAllTariffs(): Promise<TariffUpdateResult> {
    // Получаем текущую дату в московском часовом поясе (UTC+3)
    const currentDate = this.getCurrentDateInMoscow();
    this.logger.info('Обновление тарифов за текущую дату', { currentDate });

    return this.updateTariffsForDate(currentDate);
  }

  /**
   * Получение данных из Wildberries API с обработкой ошибок
   */
  private async fetchTariffsFromApi(date: string): Promise<BoxTariffResponse> {
    const endOperation = this.logger.startOperation('fetchTariffsFromApi', { date });

    try {
      const result = await this.apiClient.getTariffs(date);
      endOperation();
      return result;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Ошибка при получении данных из API', { date });
      throw error;
    }
  }

  /**
   * Обработка и сохранение данных в транзакции
   */
  private async processAndSaveData(
    warehouseList: WarehouseWithTariffsData[],
    date: string,
    dtTillMax: string | null = null,
    dtNextBox: string | null = null
  ): Promise<{
    warehousesProcessed: number;
    tariffsProcessed: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let warehousesProcessed = 0;
    let tariffsProcessed = 0;

    // Используем транзакцию для атомарности операций
    const trx = await knex.transaction();

    try {
      // 1. Обработка складов и тарифов
      this.logger.info('Начало обработки складов с тарифами', { count: warehouseList.length });

      for (const warehouseData of warehouseList) {
        try {
          // Сначала обрабатываем склад
          const warehouse = await this.processWarehouse({
            warehouseName: warehouseData.warehouseName,
            geoName: warehouseData.geoName
          }, trx);
          warehousesProcessed++;

          this.logger.debug('Склад обработан', {
            warehouse_name: warehouseData.warehouseName,
            db_id: warehouse.id
          });

          // Затем обрабатываем тариф для этого склада
          await this.processTariffFromWarehouseData(warehouseData, warehouse.id, date, dtTillMax, dtNextBox, trx);
          tariffsProcessed++;

          if (tariffsProcessed % 10 === 0) {
            this.logger.debug('Обработка тарифов в процессе', { processed: tariffsProcessed });
          }
        } catch (error) {
          const errorMsg = `Ошибка обработки склада ${warehouseData.warehouseName}: ${(error as Error).message}`;
          this.logger.error(errorMsg, { warehouse: warehouseData.warehouseName });
          errors.push(errorMsg);
        }
      }

      // Коммитим транзакцию если нет критических ошибок
      if (errors.length === 0 || tariffsProcessed > 0) {
        await trx.commit();
        this.logger.info('Транзакция успешно закоммичена', {
          warehousesProcessed,
          tariffsProcessed,
          errorsCount: errors.length
        });
      } else {
        await trx.rollback();
        this.logger.warn('Транзакция откачена из-за ошибок', { errorsCount: errors.length });
      }

      return {
        warehousesProcessed,
        tariffsProcessed,
        errors,
      };
    } catch (error) {
      await trx.rollback();
      this.logger.logError(error as Error, 'Ошибка в транзакции, откат изменений', {
        warehousesProcessed,
        tariffsProcessed
      });
      throw error;
    }
  }

  /**
   * Обработка одного склада (upsert)
   */
  private async processWarehouse(
    warehouseData: WarehouseData,
    trx: any
  ) {
    // Используем временный контекст транзакции для warehouse service
    const result = await trx.raw(`
      INSERT INTO warehouses (warehouse_name, geo_name, created_at, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (warehouse_name)
      DO UPDATE SET
        geo_name = EXCLUDED.geo_name,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [warehouseData.warehouseName, warehouseData.geoName || null]);

    const rows = result.rows || result;
    return Array.isArray(rows) ? rows[0] : rows;
  }

  /**
   * Обработка одного тарифа (upsert)
   */
  private async processTariff(
    boxTariff: BoxTariff,
    warehouseDbId: number,
    date: string,
    trx: any
  ) {
    // Трансформация данных: преобразование "-" в NULL уже произошло в Zod схеме
    const result = await trx.raw(`
      INSERT INTO box_tariffs (
        warehouse_id, tariff_date,
        box_delivery_base, box_delivery_liter, box_delivery_coef_expr,
        box_delivery_marketplace_base, box_delivery_marketplace_liter, box_delivery_marketplace_coef_expr,
        box_storage_base, box_storage_liter, box_storage_coef_expr,
        dt_next_box, dt_till_max,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (warehouse_id, tariff_date)
      DO UPDATE SET
        box_delivery_base = EXCLUDED.box_delivery_base,
        box_delivery_liter = EXCLUDED.box_delivery_liter,
        box_delivery_coef_expr = EXCLUDED.box_delivery_coef_expr,
        box_delivery_marketplace_base = EXCLUDED.box_delivery_marketplace_base,
        box_delivery_marketplace_liter = EXCLUDED.box_delivery_marketplace_liter,
        box_delivery_marketplace_coef_expr = EXCLUDED.box_delivery_marketplace_coef_expr,
        box_storage_base = EXCLUDED.box_storage_base,
        box_storage_liter = EXCLUDED.box_storage_liter,
        box_storage_coef_expr = EXCLUDED.box_storage_coef_expr,
        dt_next_box = EXCLUDED.dt_next_box,
        dt_till_max = EXCLUDED.dt_till_max,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      warehouseDbId,
      date,
      boxTariff.box_delivery_base,
      boxTariff.box_delivery_liter,
      boxTariff.box_delivery_coef_expr,
      boxTariff.box_delivery_marketplace_base,
      boxTariff.box_delivery_marketplace_liter,
      boxTariff.box_delivery_marketplace_coef_expr,
      boxTariff.box_storage_base,
      boxTariff.box_storage_liter,
      boxTariff.box_storage_coef_expr,
      boxTariff.dt_next_box,
      boxTariff.dt_till_max,
    ]);

    const rows = result.rows || result;
    return Array.isArray(rows) ? rows[0] : rows;
  }

  /**
   * Обработка одного тарифа из данных склада (upsert)
   */
  private async processTariffFromWarehouseData(
    warehouseData: WarehouseWithTariffsData,
    warehouseDbId: number,
    date: string,
    dtTillMax: string | null,
    dtNextBox: string | null = null,
    trx: any
  ) {
    // Используем единый метод преобразования данных
    const tariffData = TariffTransformer.fromWarehouseData(
      warehouseData,
      warehouseDbId,
      date,
      dtNextBox,
      dtTillMax
    );

    // Трансформация данных: преобразование "-" в NULL уже произошло в Zod схеме
    const result = await trx.raw(`
      INSERT INTO box_tariffs (
        warehouse_id, tariff_date,
        box_delivery_base, box_delivery_liter, box_delivery_coef_expr,
        box_delivery_marketplace_base, box_delivery_marketplace_liter, box_delivery_marketplace_coef_expr,
        box_storage_base, box_storage_liter, box_storage_coef_expr,
        dt_next_box, dt_till_max,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (warehouse_id, tariff_date)
      DO UPDATE SET
        box_delivery_base = EXCLUDED.box_delivery_base,
        box_delivery_liter = EXCLUDED.box_delivery_liter,
        box_delivery_coef_expr = EXCLUDED.box_delivery_coef_expr,
        box_delivery_marketplace_base = EXCLUDED.box_delivery_marketplace_base,
        box_delivery_marketplace_liter = EXCLUDED.box_delivery_marketplace_liter,
        box_delivery_marketplace_coef_expr = EXCLUDED.box_delivery_marketplace_coef_expr,
        box_storage_base = EXCLUDED.box_storage_base,
        box_storage_liter = EXCLUDED.box_storage_liter,
        box_storage_coef_expr = EXCLUDED.box_storage_coef_expr,
        dt_next_box = EXCLUDED.dt_next_box,
        dt_till_max = EXCLUDED.dt_till_max,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      tariffData.warehouse_id,
      tariffData.tariff_date,
      tariffData.box_delivery_base,
      tariffData.box_delivery_liter,
      tariffData.box_delivery_coef_expr,
      tariffData.box_delivery_marketplace_base,
      tariffData.box_delivery_marketplace_liter,
      tariffData.box_delivery_marketplace_coef_expr,
      tariffData.box_storage_base,
      tariffData.box_storage_liter,
      tariffData.box_storage_coef_expr,
      tariffData.dt_next_box,
      tariffData.dt_till_max,
    ]);

    const rows = result.rows || result;
    return Array.isArray(rows) ? rows[0] : rows;
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
   * Валидация формата даты
   */
  private isValidDate(dateString: string): boolean {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) return false;

    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
  }

  /**
   * Генерация ID склада из имени (та же логика, что и в API клиенте)
   */
  private generateWarehouseId(warehouseName: string): string {
    return warehouseName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }
}

// Экспорт экземпляра для использования в приложении
export const tariffsUpdater = new TariffsUpdater();

// Экспорт по умолчанию
export default TariffsUpdater;