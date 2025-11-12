import knex from '#postgres/knex.js';
import { BoxTariff } from '../types/wildberries.js';
import { getDatabaseLogger } from '../utils/logger.js';
import { TariffTransformer } from '../utils/tariff-transformer.js';

// Интерфейс для тарифа в базе данных
export interface Tariff {
  id: number;
  warehouse_id: number;
  tariff_date: Date;

  // Тарифы доставки FBO
  box_delivery_base: number | null;
  box_delivery_liter: number | null;
  box_delivery_coef_expr: number | null;

  // Тарифы доставки FBS
  box_delivery_marketplace_base: number | null;
  box_delivery_marketplace_liter: number | null;
  box_delivery_marketplace_coef_expr: number | null;

  // Тарифы хранения
  box_storage_base: number | null;
  box_storage_liter: number | null;
  box_storage_coef_expr: number | null;

  // Метаданные
  dt_next_box: string | null;
  dt_till_max: Date | null;

  // Системные поля
  created_at: Date;
  updated_at: Date;
}

// Интерфейс для создания тарифа
export interface CreateTariffRequest {
  warehouse_id: number;
  tariff_date: Date | string;

  // Тарифы доставки FBO
  box_delivery_base?: number | null;
  box_delivery_liter?: number | null;
  box_delivery_coef_expr?: number | null;

  // Тарифы доставки FBS
  box_delivery_marketplace_base?: number | null;
  box_delivery_marketplace_liter?: number | null;
  box_delivery_marketplace_coef_expr?: number | null;

  // Тарифы хранения
  box_storage_base?: number | null;
  box_storage_liter?: number | null;
  box_storage_coef_expr?: number | null;

  // Метаданные
  dt_next_box?: string | null;
  dt_till_max?: Date | string | null;
}

// Интерфейс для обновления тарифа
export interface UpdateTariffRequest {
  warehouse_id?: number;
  tariff_date?: Date | string;

  // Тарифы доставки FBO
  box_delivery_base?: number | null;
  box_delivery_liter?: number | null;
  box_delivery_coef_expr?: number | null;

  // Тарифы доставки FBS
  box_delivery_marketplace_base?: number | null;
  box_delivery_marketplace_liter?: number | null;
  box_delivery_marketplace_coef_expr?: number | null;

  // Тарифы хранения
  box_storage_base?: number | null;
  box_storage_liter?: number | null;
  box_storage_coef_expr?: number | null;

  // Метаданные
  dt_next_box?: string | null;
  dt_till_max?: Date | string | null;
}

/**
 * Сервис для работы с таблицей box_tariffs
 */
export class TariffService {
  private logger = getDatabaseLogger('TariffService');
  /**
   * Получение всех тарифов
   * @returns Promise<Tariff[]> - массив всех тарифов
   */
  async getAll(): Promise<Tariff[]> {
    const endOperation = this.logger.startOperation('getAll');

    try {
      this.logger.logDbOperation('SELECT', 'box_tariffs');
      const tariffs = await knex<Tariff>('box_tariffs')
        .select('*')
        .orderBy('tariff_date', 'desc');

      this.logger.debug('Получены все тарифы', { count: tariffs.length });
      endOperation();
      return tariffs;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Ошибка при получении всех тарифов');
      throw new Error(`Не удалось получить тарифы: ${(error as Error).message}`);
    }
  }

  /**
   * Получение тарифа по ID
   * @param id - идентификатор тарифа
   * @returns Promise<Tariff | null> - тариф или null, если не найден
   */
  async getById(id: number): Promise<Tariff | null> {
    try {
      this.logger.logDbOperation('SELECT', 'box_tariffs', { id });
      const tariff = await knex<Tariff>('box_tariffs')
        .where({ id })
        .first();

      this.logger.debug(`Тариф ${tariff ? 'найден' : 'не найден'}`, { id, found: !!tariff });
      return tariff || null;
    } catch (error) {
      this.logger.logError(error as Error, `Ошибка при получении тарифа с ID ${id}`, { id });
      throw new Error(`Не удалось получить тариф: ${(error as Error).message}`);
    }
  }

  /**
   * Получение тарифов по ID склада
   * @param warehouseId - идентификатор склада
   * @param dateFrom - начальная дата (опционально)
   * @param dateTo - конечная дата (опционально)
   * @returns Promise<Tariff[]> - массив тарифов для указанного склада
   */
  async getByWarehouseId(
    warehouseId: number,
    dateFrom?: Date | string,
    dateTo?: Date | string
  ): Promise<Tariff[]> {
    const endOperation = this.logger.startOperation('getByWarehouseId', { warehouseId, dateFrom, dateTo });

    try {
      this.logger.logDbOperation('SELECT', 'box_tariffs', { warehouse_id: warehouseId, dateFrom, dateTo });
      let query = knex<Tariff>('box_tariffs')
        .where({ warehouse_id: warehouseId });

      if (dateFrom) {
        query = query.where('tariff_date', '>=', dateFrom);
      }

      if (dateTo) {
        query = query.where('tariff_date', '<=', dateTo);
      }

      const tariffs = await query.orderBy('tariff_date', 'desc');

      this.logger.debug('Получены тарифы для склада', { warehouseId, count: tariffs.length });
      endOperation();
      return tariffs;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, `Ошибка при получении тарифов для склада ${warehouseId}`, { warehouseId });
      throw new Error(`Не удалось получить тарифы: ${(error as Error).message}`);
    }
  }

  /**
   * Получение тарифов по дате
   * @param date - дата тарифа
   * @returns Promise<Tariff[]> - массив тарифов за указанную дату
   */
  async getByDate(date: Date | string): Promise<Tariff[]> {
    const endOperation = this.logger.startOperation('getByDate', { date });

    try {
      // Преобразуем дату в строку формата YYYY-MM-DD для корректного сравнения
      const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];

      this.logger.logDbOperation('SELECT', 'box_tariffs', { tariff_date: dateStr });
      const tariffs = await knex<Tariff>('box_tariffs')
        .where('tariff_date', dateStr)
        .orderBy('warehouse_id');

      this.logger.debug('Получены тарифы за дату', { date: dateStr, count: tariffs.length });
      endOperation();
      return tariffs;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, `Ошибка при получении тарифов за дату ${date}`, { date });
      throw new Error(`Не удалось получить тарифы: ${(error as Error).message}`);
    }
  }

  /**
   * Создание нового тарифа
   * @param tariff - данные для создания тарифа
   * @returns Promise<Tariff> - созданный тариф
   */
  async create(tariff: CreateTariffRequest): Promise<Tariff> {
    const endOperation = this.logger.startOperation('create', {
      warehouse_id: tariff.warehouse_id,
      tariff_date: tariff.tariff_date
    });

    try {
      this.logger.logDbOperation('INSERT', 'box_tariffs', {
        warehouse_id: tariff.warehouse_id,
        tariff_date: tariff.tariff_date
      });

      // Преобразуем даты в объекты Date для корректной вставки
      const tariffDate = typeof tariff.tariff_date === 'string'
        ? new Date(tariff.tariff_date)
        : tariff.tariff_date;

      const dtTillMax = tariff.dt_till_max
        ? (typeof tariff.dt_till_max === 'string' ? new Date(tariff.dt_till_max) : tariff.dt_till_max)
        : null;

      const [createdTariff] = await knex<Tariff>('box_tariffs')
        .insert({
          warehouse_id: tariff.warehouse_id,
          tariff_date: tariffDate,
          box_delivery_base: tariff.box_delivery_base ?? null,
          box_delivery_liter: tariff.box_delivery_liter ?? null,
          box_delivery_coef_expr: tariff.box_delivery_coef_expr ?? null,
          box_delivery_marketplace_base: tariff.box_delivery_marketplace_base ?? null,
          box_delivery_marketplace_liter: tariff.box_delivery_marketplace_liter ?? null,
          box_delivery_marketplace_coef_expr: tariff.box_delivery_marketplace_coef_expr ?? null,
          box_storage_base: tariff.box_storage_base ?? null,
          box_storage_liter: tariff.box_storage_liter ?? null,
          box_storage_coef_expr: tariff.box_storage_coef_expr ?? null,
          dt_next_box: tariff.dt_next_box ?? null,
          dt_till_max: dtTillMax,
        })
        .returning('*');

      this.logger.info('Тариф создан', {
        id: createdTariff.id,
        warehouse_id: createdTariff.warehouse_id,
        tariff_date: createdTariff.tariff_date
      });
      endOperation();
      return createdTariff;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Ошибка при создании тарифа', { tariff });
      throw new Error(`Не удалось создать тариф: ${(error as Error).message}`);
    }
  }

  /**
   * Обновление тарифа
   * @param id - идентификатор тарифа
   * @param tariff - данные для обновления тарифа
   * @returns Promise<Tariff | null> - обновленный тариф или null, если не найден
   */
  async update(id: number, tariff: UpdateTariffRequest): Promise<Tariff | null> {
    try {
      const updateData: any = {
        updated_at: new Date(),
      };

      // Добавляем только переданные поля
      if (tariff.warehouse_id !== undefined) updateData.warehouse_id = tariff.warehouse_id;
      if (tariff.tariff_date !== undefined) updateData.tariff_date = tariff.tariff_date;
      if (tariff.box_delivery_base !== undefined) updateData.box_delivery_base = tariff.box_delivery_base;
      if (tariff.box_delivery_liter !== undefined) updateData.box_delivery_liter = tariff.box_delivery_liter;
      if (tariff.box_delivery_coef_expr !== undefined) updateData.box_delivery_coef_expr = tariff.box_delivery_coef_expr;
      if (tariff.box_delivery_marketplace_base !== undefined) updateData.box_delivery_marketplace_base = tariff.box_delivery_marketplace_base;
      if (tariff.box_delivery_marketplace_liter !== undefined) updateData.box_delivery_marketplace_liter = tariff.box_delivery_marketplace_liter;
      if (tariff.box_delivery_marketplace_coef_expr !== undefined) updateData.box_delivery_marketplace_coef_expr = tariff.box_delivery_marketplace_coef_expr;
      if (tariff.box_storage_base !== undefined) updateData.box_storage_base = tariff.box_storage_base;
      if (tariff.box_storage_liter !== undefined) updateData.box_storage_liter = tariff.box_storage_liter;
      if (tariff.box_storage_coef_expr !== undefined) updateData.box_storage_coef_expr = tariff.box_storage_coef_expr;
      if (tariff.dt_next_box !== undefined) updateData.dt_next_box = tariff.dt_next_box;
      if (tariff.dt_till_max !== undefined) updateData.dt_till_max = tariff.dt_till_max;

      const [updatedTariff] = await knex<Tariff>('box_tariffs')
        .where({ id })
        .update(updateData)
        .returning('*');

      return updatedTariff || null;
    } catch (error) {
      console.error(`Ошибка при обновлении тарифа с ID ${id}:`, error);
      throw new Error(`Не удалось обновить тариф: ${(error as Error).message}`);
    }
  }

  /**
   * Создание или обновление тарифа с использованием ON CONFLICT
   * @param tariff - данные тарифа
   * @returns Promise<Tariff> - созданный или обновленный тариф
   */
  async upsert(tariff: CreateTariffRequest): Promise<Tariff> {
    const endOperation = this.logger.startOperation('upsert', {
      warehouse_id: tariff.warehouse_id,
      tariff_date: tariff.tariff_date
    });

    try {
      this.logger.logDbOperation('UPSERT', 'box_tariffs', {
        warehouse_id: tariff.warehouse_id,
        tariff_date: tariff.tariff_date
      });

      const result = await knex.raw(`
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
        tariff.warehouse_id,
        tariff.tariff_date,
        tariff.box_delivery_base ?? null,
        tariff.box_delivery_liter ?? null,
        tariff.box_delivery_coef_expr ?? null,
        tariff.box_delivery_marketplace_base ?? null,
        tariff.box_delivery_marketplace_liter ?? null,
        tariff.box_delivery_marketplace_coef_expr ?? null,
        tariff.box_storage_base ?? null,
        tariff.box_storage_liter ?? null,
        tariff.box_storage_coef_expr ?? null,
        tariff.dt_next_box ?? null,
        tariff.dt_till_max ?? null,
      ]);

      // Knex raw возвращает разные форматы в зависимости от драйвера БД
      // Для PostgreSQL результат будет в result.rows
      const rows = result.rows || result;
      const upsertedTariff = Array.isArray(rows) ? rows[0] : rows;

      this.logger.info('Тариф upsert через ON CONFLICT', {
        id: upsertedTariff.id,
        warehouse_id: upsertedTariff.warehouse_id,
        tariff_date: upsertedTariff.tariff_date
      });
      endOperation();
      return upsertedTariff;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Ошибка при upsert с ON CONFLICT для тарифа', { tariff });
      throw new Error(`Не удалось выполнить upsert для тарифа: ${(error as Error).message}`);
    }
  }

  /**
   * Удаление тарифа
   * @param id - идентификатор тарифа
   * @returns Promise<boolean> - true, если тариф был удален, иначе false
   */
  async delete(id: number): Promise<boolean> {
    try {
      const deletedCount = await knex<Tariff>('box_tariffs')
        .where({ id })
        .del();

      return deletedCount > 0;
    } catch (error) {
      console.error(`Ошибка при удалении тарифа с ID ${id}:`, error);
      throw new Error(`Не удалось удалить тариф: ${(error as Error).message}`);
    }
  }

  /**
   * Получение последних актуальных тарифов для всех складов
   * @returns Promise<Tariff[]> - массив последних тарифов для каждого склада
   */
  async getLatestTariffs(): Promise<Tariff[]> {
    const endOperation = this.logger.startOperation('getLatestTariffs');

    try {
      this.logger.logDbOperation('SELECT', 'box_tariffs', { operation: 'getLatestTariffs' });

      // Получаем последнюю дату для каждого склада
      const latestDates = await knex<Tariff>('box_tariffs')
        .select('warehouse_id')
        .max('tariff_date as max_date')
        .groupBy('warehouse_id') as Array<{ warehouse_id: number; max_date: Date }>;

      // Получаем тарифы для этих дат
      const tariffs: Tariff[] = [];
      for (const { warehouse_id, max_date } of latestDates) {
        const tariff = await knex<Tariff>('box_tariffs')
          .where({
            warehouse_id,
            tariff_date: max_date,
          })
          .first();

        if (tariff) {
          tariffs.push(tariff);
        }
      }

      this.logger.debug('Получены последние тарифы', { count: tariffs.length });
      endOperation();
      return tariffs;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Ошибка при получении последних тарифов');
      throw new Error(`Не удалось получить последние тарифы: ${(error as Error).message}`);
    }
  }

  /**
   * Преобразование данных из API Wildberries в формат для базы данных
   * @param boxTariff - данные тарифа из API
   * @param warehouseId - ID склада в базе данных
   * @param tariffDate - дата тарифа
   * @returns CreateTariffRequest - данные для создания/обновления тарифа
   * @deprecated Используйте TariffTransformer.fromBoxTariff() вместо этого метода
   */
  static fromWildberriesData(
    boxTariff: BoxTariff,
    warehouseId: number,
    tariffDate: Date | string
  ): CreateTariffRequest {
    return TariffTransformer.fromBoxTariff(boxTariff, warehouseId, tariffDate);
  }
}

// Экспорт экземпляра сервиса для использования в приложении
export const tariffService = new TariffService();

// Экспорт по умолчанию для удобства
export default TariffService;