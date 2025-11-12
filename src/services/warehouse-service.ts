import knex from '#postgres/knex.js';
import { WarehouseData } from '../types/wildberries.js';
import { getDatabaseLogger } from '../utils/logger.js';

// Интерфейс для склада в базе данных
export interface Warehouse {
  id: number;
  warehouse_name: string;
  geo_name: string | null;
  created_at: Date;
  updated_at: Date;
}

// Интерфейс для создания склада
export interface CreateWarehouseRequest {
  warehouse_name: string;
  geo_name?: string | null;
}

// Интерфейс для обновления склада
export interface UpdateWarehouseRequest {
  warehouse_name?: string;
  geo_name?: string | null;
}

/**
 * Сервис для работы с таблицей warehouses
 */
export class WarehouseService {
  private logger = getDatabaseLogger('WarehouseService');
  /**
   * Получение всех складов
   * @returns Promise<Warehouse[]> - массив всех складов
   */
  async getAll(): Promise<Warehouse[]> {
    const endOperation = this.logger.startOperation('getAll');

    try {
      this.logger.logDbOperation('SELECT', 'warehouses');
      const warehouses = await knex<Warehouse>('warehouses')
        .select('*')
        .orderBy('warehouse_name');

      this.logger.debug('Получены все склады', { count: warehouses.length });
      endOperation();
      return warehouses;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Ошибка при получении всех складов');
      throw new Error(`Не удалось получить склады: ${(error as Error).message}`);
    }
  }

  /**
   * Получение склада по ID
   * @param id - идентификатор склада
   * @returns Promise<Warehouse | null> - склад или null, если не найден
   */
  async getById(id: number): Promise<Warehouse | null> {
    try {
      this.logger.logDbOperation('SELECT', 'warehouses', { id });
      const warehouse = await knex<Warehouse>('warehouses')
        .where({ id })
        .first();

      this.logger.debug(`Склад ${warehouse ? 'найден' : 'не найден'}`, { id, found: !!warehouse });
      return warehouse || null;
    } catch (error) {
      this.logger.logError(error as Error, `Ошибка при получении склада с ID ${id}`, { id });
      throw new Error(`Не удалось получить склад: ${(error as Error).message}`);
    }
  }

  /**
   * Получение склада по названию
   * @param name - название склада
   * @returns Promise<Warehouse | null> - склад или null, если не найден
   */
  async getByName(name: string): Promise<Warehouse | null> {
    try {
      this.logger.logDbOperation('SELECT', 'warehouses', { warehouse_name: name });
      const warehouse = await knex<Warehouse>('warehouses')
        .where({ warehouse_name: name })
        .first();

      this.logger.debug(`Склад ${warehouse ? 'найден' : 'не найден'}`, { name, found: !!warehouse });
      return warehouse || null;
    } catch (error) {
      this.logger.logError(error as Error, `Ошибка при получении склада с названием "${name}"`, { name });
      throw new Error(`Не удалось получить склад: ${(error as Error).message}`);
    }
  }

  /**
   * Создание нового склада
   * @param warehouse - данные для создания склада
   * @returns Promise<Warehouse> - созданный склад
   */
  async create(warehouse: CreateWarehouseRequest): Promise<Warehouse> {
    const endOperation = this.logger.startOperation('create', { warehouse_name: warehouse.warehouse_name });

    try {
      this.logger.logDbOperation('INSERT', 'warehouses', { warehouse_name: warehouse.warehouse_name });
      const [createdWarehouse] = await knex<Warehouse>('warehouses')
        .insert({
          warehouse_name: warehouse.warehouse_name,
          geo_name: warehouse.geo_name || null,
        })
        .returning('*');

      this.logger.info('Склад создан', {
        id: createdWarehouse.id,
        warehouse_name: createdWarehouse.warehouse_name
      });
      endOperation();
      return createdWarehouse;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Ошибка при создании склада', { warehouse });
      throw new Error(`Не удалось создать склад: ${(error as Error).message}`);
    }
  }

  /**
   * Обновление склада
   * @param id - идентификатор склада
   * @param warehouse - данные для обновления склада
   * @returns Promise<Warehouse | null> - обновленный склад или null, если не найден
   */
  async update(id: number, warehouse: UpdateWarehouseRequest): Promise<Warehouse | null> {
    const endOperation = this.logger.startOperation('update', { id });

    try {
      this.logger.logDbOperation('UPDATE', 'warehouses', { id, changes: warehouse });
      const [updatedWarehouse] = await knex<Warehouse>('warehouses')
        .where({ id })
        .update({
          ...(warehouse.warehouse_name && { warehouse_name: warehouse.warehouse_name }),
          ...(warehouse.geo_name !== undefined && { geo_name: warehouse.geo_name }),
          updated_at: new Date(),
        })
        .returning('*');

      this.logger.info(`Склад ${updatedWarehouse ? 'обновлен' : 'не найден'}`, {
        id,
        updated: !!updatedWarehouse
      });
      endOperation();
      return updatedWarehouse || null;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, `Ошибка при обновлении склада с ID ${id}`, { id, warehouse });
      throw new Error(`Не удалось обновить склад: ${(error as Error).message}`);
    }
  }

  /**
   * Создание или обновление склада (upsert)
   * @param warehouse - данные склада
   * @returns Promise<Warehouse> - созданный или обновленный склад
   */
  async upsert(warehouse: CreateWarehouseRequest): Promise<Warehouse> {
    const endOperation = this.logger.startOperation('upsert', { warehouse_name: warehouse.warehouse_name });

    try {
      // Проверяем, существует ли склад с таким названием
      const existingWarehouse = await this.getByName(warehouse.warehouse_name);

      if (existingWarehouse) {
        // Если склад существует, обновляем его
        this.logger.debug('Склад существует, обновляем', {
          id: existingWarehouse.id,
          warehouse_name: warehouse.warehouse_name
        });

        const [updatedWarehouse] = await knex<Warehouse>('warehouses')
          .where({ id: existingWarehouse.id })
          .update({
            geo_name: warehouse.geo_name || null,
            updated_at: new Date(),
          })
          .returning('*');

        this.logger.info('Склад обновлен через upsert', {
          id: updatedWarehouse.id,
          warehouse_name: updatedWarehouse.warehouse_name
        });
        endOperation();
        return updatedWarehouse;
      } else {
        // Если склад не существует, создаем новый
        this.logger.debug('Склад не существует, создаем новый', { warehouse_name: warehouse.warehouse_name });
        const result = await this.create(warehouse);
        endOperation();
        return result;
      }
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Ошибка при upsert операции со складом', { warehouse });
      throw new Error(`Не удалось выполнить upsert для склада: ${(error as Error).message}`);
    }
  }

  /**
   * Создание или обновление склада с использованием ON CONFLICT
   * @param warehouse - данные склада
   * @returns Promise<Warehouse> - созданный или обновленный склад
   */
  async upsertWithConflict(warehouse: CreateWarehouseRequest): Promise<Warehouse> {
    const endOperation = this.logger.startOperation('upsertWithConflict', { warehouse_name: warehouse.warehouse_name });

    try {
      this.logger.logDbOperation('UPSERT', 'warehouses', { warehouse_name: warehouse.warehouse_name });
      const result = await knex.raw(`
        INSERT INTO warehouses (warehouse_name, geo_name, created_at, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (warehouse_name)
        DO UPDATE SET
          geo_name = EXCLUDED.geo_name,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [warehouse.warehouse_name, warehouse.geo_name || null]);

      // Knex raw возвращает разные форматы в зависимости от драйвера БД
      // Для PostgreSQL результат будет в result.rows
      const rows = result.rows || result;
      const upsertedWarehouse = Array.isArray(rows) ? rows[0] : rows;

      this.logger.info('Склад upsert через ON CONFLICT', {
        id: upsertedWarehouse.id,
        warehouse_name: upsertedWarehouse.warehouse_name
      });
      endOperation();
      return upsertedWarehouse;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Ошибка при upsert с ON CONFLICT для склада', { warehouse });
      throw new Error(`Не удалось выполнить upsert для склада: ${(error as Error).message}`);
    }
  }

  /**
   * Удаление склада
   * @param id - идентификатор склада
   * @returns Promise<boolean> - true, если склад был удален, иначе false
   */
  async delete(id: number): Promise<boolean> {
    const endOperation = this.logger.startOperation('delete', { id });

    try {
      this.logger.logDbOperation('DELETE', 'warehouses', { id });
      const deletedCount = await knex<Warehouse>('warehouses')
        .where({ id })
        .del();

      const deleted = deletedCount > 0;
      this.logger.info(`Склад ${deleted ? 'удален' : 'не найден'}`, { id, deleted });
      endOperation();
      return deleted;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, `Ошибка при удалении склада с ID ${id}`, { id });
      throw new Error(`Не удалось удалить склад: ${(error as Error).message}`);
    }
  }

  /**
   * Преобразование данных из API Wildberries в формат для базы данных
   * @param warehouseData - данные склада из API
   * @returns CreateWarehouseRequest - данные для создания/обновления склада
   */
  static fromWildberriesData(warehouseData: WarehouseData): CreateWarehouseRequest {
    return {
      warehouse_name: warehouseData.warehouseName,
      geo_name: warehouseData.geoName || null,
    };
  }
}

// Экспорт экземпляра сервиса для использования в приложении
export const warehouseService = new WarehouseService();

// Экспорт по умолчанию для удобства
export default WarehouseService;