import knex from '#postgres/knex.js';
import { Spreadsheet, CreateSpreadsheetRequest, UpdateSpreadsheetRequest, SpreadsheetSyncResult } from '../types/wildberries.js';
import { getDatabaseLogger } from '../utils/logger.js';

/**
 * Сервис для работы с таблицей spreadsheets
 */
export class SpreadsheetService {
  private logger = getDatabaseLogger('SpreadsheetService');

  /**
   * Получение всех spreadsheets
   * @returns Promise<Spreadsheet[]> - массив всех spreadsheets
   */
  async getAll(): Promise<Spreadsheet[]> {
    const endOperation = this.logger.startOperation('getAll');

    try {
      this.logger.logDbOperation('SELECT', 'spreadsheets');
      const spreadsheets = await knex<Spreadsheet>('spreadsheets')
        .select('*')
        .orderBy(['spreadsheet_id', 'sheet_name']);

      this.logger.debug('Получены все spreadsheets', { count: spreadsheets.length });
      endOperation();
      return spreadsheets;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Ошибка при получении всех spreadsheets');
      throw new Error(`Не удалось получить spreadsheets: ${(error as Error).message}`);
    }
  }

  /**
   * Получение spreadsheet по составному ключу (spreadsheet_id, sheet_name)
   * @param spreadsheetId - ID таблицы
   * @param sheetName - имя листа
   * @returns Promise<Spreadsheet | null> - spreadsheet или null, если не найден
   */
  async getById(spreadsheetId: string, sheetName: string): Promise<Spreadsheet | null> {
    try {
      this.logger.logDbOperation('SELECT', 'spreadsheets', { spreadsheet_id: spreadsheetId, sheet_name: sheetName });
      const spreadsheet = await knex<Spreadsheet>('spreadsheets')
        .where({ spreadsheet_id: spreadsheetId, sheet_name: sheetName })
        .first();

      this.logger.debug(`Spreadsheet ${spreadsheet ? 'найден' : 'не найден'}`, {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        found: !!spreadsheet
      });
      return spreadsheet || null;
    } catch (error) {
      this.logger.logError(error as Error, `Ошибка при получении spreadsheet с ID ${spreadsheetId} и листом ${sheetName}`, {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName
      });
      throw new Error(`Не удалось получить spreadsheet: ${(error as Error).message}`);
    }
  }

  /**
   * Получение активных spreadsheets
   * @returns Promise<Spreadsheet[]> - массив активных spreadsheets
   */
  async getActive(): Promise<Spreadsheet[]> {
    const endOperation = this.logger.startOperation('getActive');

    try {
      this.logger.logDbOperation('SELECT', 'spreadsheets', { is_active: true });
      const spreadsheets = await knex<Spreadsheet>('spreadsheets')
        .where({ is_active: true })
        .orderBy(['spreadsheet_id', 'sheet_name']);

      this.logger.debug('Получены активные spreadsheets', { count: spreadsheets.length });
      endOperation();
      return spreadsheets;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Ошибка при получении активных spreadsheets');
      throw new Error(`Не удалось получить активные spreadsheets: ${(error as Error).message}`);
    }
  }

  /**
   * Получение spreadsheets по ID таблицы
   * @param spreadsheetId - ID таблицы
   * @returns Promise<Spreadsheet[]> - массив spreadsheets для указанного ID
   */
  async getBySpreadsheetId(spreadsheetId: string): Promise<Spreadsheet[]> {
    const endOperation = this.logger.startOperation('getBySpreadsheetId', { spreadsheet_id: spreadsheetId });

    try {
      this.logger.logDbOperation('SELECT', 'spreadsheets', { spreadsheet_id: spreadsheetId });
      const spreadsheets = await knex<Spreadsheet>('spreadsheets')
        .where({ spreadsheet_id: spreadsheetId })
        .orderBy('sheet_name');

      this.logger.debug('Получены spreadsheets для ID', { spreadsheet_id: spreadsheetId, count: spreadsheets.length });
      endOperation();
      return spreadsheets;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, `Ошибка при получении spreadsheets для ID ${spreadsheetId}`, {
        spreadsheet_id: spreadsheetId
      });
      throw new Error(`Не удалось получить spreadsheets: ${(error as Error).message}`);
    }
  }

  /**
   * Получение spreadsheets, требующих синхронизации
   * @param hoursSinceLastSync - количество часов с последней синхронизации (по умолчанию 24)
   * @returns Promise<Spreadsheet[]> - массив spreadsheets, требующих синхронизации
   */
  async getPendingSync(hoursSinceLastSync: number = 24): Promise<Spreadsheet[]> {
    const endOperation = this.logger.startOperation('getPendingSync', { hoursSinceLastSync });

    try {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - hoursSinceLastSync);

      this.logger.logDbOperation('SELECT', 'spreadsheets', {
        is_active: true,
        last_synced_at: { $lt: cutoffTime }
      });

      const spreadsheets = await knex<Spreadsheet>('spreadsheets')
        .where({ is_active: true })
        .where(function() {
          this.whereNull('last_synced_at').orWhere('last_synced_at', '<', cutoffTime);
        })
        .orderBy(['spreadsheet_id', 'sheet_name']);

      this.logger.debug('Получены spreadsheets для синхронизации', { count: spreadsheets.length });
      endOperation();
      return spreadsheets;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Ошибка при получении spreadsheets для синхронизации');
      throw new Error(`Не удалось получить spreadsheets для синхронизации: ${(error as Error).message}`);
    }
  }

  /**
   * Создание нового spreadsheet
   * @param spreadsheet - данные для создания spreadsheet
   * @returns Promise<Spreadsheet> - созданный spreadsheet
   */
  async create(spreadsheet: CreateSpreadsheetRequest): Promise<Spreadsheet> {
    const endOperation = this.logger.startOperation('create', {
      spreadsheet_id: spreadsheet.spreadsheet_id,
      sheet_name: spreadsheet.sheet_name
    });

    try {
      this.logger.logDbOperation('INSERT', 'spreadsheets', {
        spreadsheet_id: spreadsheet.spreadsheet_id,
        sheet_name: spreadsheet.sheet_name
      });

      const [createdSpreadsheet] = await knex<Spreadsheet>('spreadsheets')
        .insert({
          spreadsheet_id: spreadsheet.spreadsheet_id,
          sheet_name: spreadsheet.sheet_name,
          description: spreadsheet.description || null,
          is_active: spreadsheet.is_active !== undefined ? spreadsheet.is_active : true,
          last_synced_at: spreadsheet.last_synced_at || null,
          credentials_ref: spreadsheet.credentials_ref || null,
        })
        .returning('*');

      this.logger.info('Spreadsheet создан', {
        spreadsheet_id: createdSpreadsheet.spreadsheet_id,
        sheet_name: createdSpreadsheet.sheet_name
      });
      endOperation();
      return createdSpreadsheet;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Ошибка при создании spreadsheet', { spreadsheet });
      throw new Error(`Не удалось создать spreadsheet: ${(error as Error).message}`);
    }
  }

  /**
   * Обновление spreadsheet
   * @param spreadsheetId - ID таблицы
   * @param sheetName - имя листа
   * @param spreadsheet - данные для обновления spreadsheet
   * @returns Promise<Spreadsheet | null> - обновленный spreadsheet или null, если не найден
   */
  async update(
    spreadsheetId: string,
    sheetName: string,
    spreadsheet: UpdateSpreadsheetRequest
  ): Promise<Spreadsheet | null> {
    const endOperation = this.logger.startOperation('update', {
      spreadsheet_id: spreadsheetId,
      sheet_name: sheetName
    });

    try {
      this.logger.logDbOperation('UPDATE', 'spreadsheets', {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        changes: spreadsheet
      });

      const updateData: any = {
        updated_at: new Date(),
      };

      // Добавляем только переданные поля
      if (spreadsheet.sheet_name !== undefined) updateData.sheet_name = spreadsheet.sheet_name;
      if (spreadsheet.description !== undefined) updateData.description = spreadsheet.description;
      if (spreadsheet.is_active !== undefined) updateData.is_active = spreadsheet.is_active;
      if (spreadsheet.last_synced_at !== undefined) updateData.last_synced_at = spreadsheet.last_synced_at;
      if (spreadsheet.credentials_ref !== undefined) updateData.credentials_ref = spreadsheet.credentials_ref;

      const [updatedSpreadsheet] = await knex<Spreadsheet>('spreadsheets')
        .where({ spreadsheet_id: spreadsheetId, sheet_name: sheetName })
        .update(updateData)
        .returning('*');

      this.logger.info(`Spreadsheet ${updatedSpreadsheet ? 'обновлен' : 'не найден'}`, {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        updated: !!updatedSpreadsheet
      });
      endOperation();
      return updatedSpreadsheet || null;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, `Ошибка при обновлении spreadsheet с ID ${spreadsheetId} и листом ${sheetName}`, {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        spreadsheet
      });
      throw new Error(`Не удалось обновить spreadsheet: ${(error as Error).message}`);
    }
  }

  /**
   * Создание или обновление spreadsheet с использованием ON CONFLICT
   * @param spreadsheet - данные spreadsheet
   * @returns Promise<Spreadsheet> - созданный или обновленный spreadsheet
   */
  async upsert(spreadsheet: CreateSpreadsheetRequest): Promise<Spreadsheet> {
    const endOperation = this.logger.startOperation('upsert', {
      spreadsheet_id: spreadsheet.spreadsheet_id,
      sheet_name: spreadsheet.sheet_name
    });

    try {
      this.logger.logDbOperation('UPSERT', 'spreadsheets', {
        spreadsheet_id: spreadsheet.spreadsheet_id,
        sheet_name: spreadsheet.sheet_name
      });

      const result = await knex.raw(`
        INSERT INTO spreadsheets (
          spreadsheet_id, sheet_name, description, is_active,
          last_synced_at, credentials_ref, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (spreadsheet_id, sheet_name)
        DO UPDATE SET
          description = EXCLUDED.description,
          is_active = EXCLUDED.is_active,
          last_synced_at = EXCLUDED.last_synced_at,
          credentials_ref = EXCLUDED.credentials_ref,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [
        spreadsheet.spreadsheet_id,
        spreadsheet.sheet_name,
        spreadsheet.description || null,
        spreadsheet.is_active !== undefined ? spreadsheet.is_active : true,
        spreadsheet.last_synced_at || null,
        spreadsheet.credentials_ref || null,
      ]);

      // Knex raw возвращает разные форматы в зависимости от драйвера БД
      // Для PostgreSQL результат будет в result.rows
      const rows = result.rows || result;
      const upsertedSpreadsheet = Array.isArray(rows) ? rows[0] : rows;

      this.logger.info('Spreadsheet upsert через ON CONFLICT', {
        spreadsheet_id: upsertedSpreadsheet.spreadsheet_id,
        sheet_name: upsertedSpreadsheet.sheet_name
      });
      endOperation();
      return upsertedSpreadsheet;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Ошибка при upsert с ON CONFLICT для spreadsheet', { spreadsheet });
      throw new Error(`Не удалось выполнить upsert для spreadsheet: ${(error as Error).message}`);
    }
  }

  /**
   * Удаление spreadsheet
   * @param spreadsheetId - ID таблицы
   * @param sheetName - имя листа
   * @returns Promise<boolean> - true, если spreadsheet был удален, иначе false
   */
  async delete(spreadsheetId: string, sheetName: string): Promise<boolean> {
    const endOperation = this.logger.startOperation('delete', {
      spreadsheet_id: spreadsheetId,
      sheet_name: sheetName
    });

    try {
      this.logger.logDbOperation('DELETE', 'spreadsheets', {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName
      });

      const deletedCount = await knex<Spreadsheet>('spreadsheets')
        .where({ spreadsheet_id: spreadsheetId, sheet_name: sheetName })
        .del();

      const deleted = deletedCount > 0;
      this.logger.info(`Spreadsheet ${deleted ? 'удален' : 'не найден'}`, {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        deleted
      });
      endOperation();
      return deleted;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, `Ошибка при удалении spreadsheet с ID ${spreadsheetId} и листом ${sheetName}`, {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName
      });
      throw new Error(`Не удалось удалить spreadsheet: ${(error as Error).message}`);
    }
  }

  /**
   * Обновление времени последней синхронизации
   * @param spreadsheetId - ID таблицы
   * @param sheetName - имя листа
   * @param syncResult - результат синхронизации
   * @returns Promise<Spreadsheet | null> - обновленный spreadsheet или null, если не найден
   */
  async updateLastSynced(
    spreadsheetId: string,
    sheetName: string,
    syncResult: SpreadsheetSyncResult
  ): Promise<Spreadsheet | null> {
    const endOperation = this.logger.startOperation('updateLastSynced', {
      spreadsheet_id: spreadsheetId,
      sheet_name: sheetName,
      success: syncResult.success
    });

    try {
      this.logger.logDbOperation('UPDATE', 'spreadsheets', {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        last_synced_at: syncResult.synced_at
      });

      const [updatedSpreadsheet] = await knex<Spreadsheet>('spreadsheets')
        .where({ spreadsheet_id: spreadsheetId, sheet_name: sheetName })
        .update({
          last_synced_at: syncResult.synced_at,
          updated_at: new Date(),
        })
        .returning('*');

      this.logger.info(`Время последней синхронизации обновлено`, {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        synced_at: syncResult.synced_at,
        success: syncResult.success,
        updated: !!updatedSpreadsheet
      });
      endOperation();
      return updatedSpreadsheet || null;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, `Ошибка при обновлении времени синхронизации для spreadsheet ${spreadsheetId} и листа ${sheetName}`, {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        syncResult
      });
      throw new Error(`Не удалось обновить время синхронизации: ${(error as Error).message}`);
    }
  }

  /**
   * Активация/деактивация spreadsheet
   * @param spreadsheetId - ID таблицы
   * @param sheetName - имя листа
   * @param isActive - флаг активности
   * @returns Promise<Spreadsheet | null> - обновленный spreadsheet или null, если не найден
   */
  async setActive(spreadsheetId: string, sheetName: string, isActive: boolean): Promise<Spreadsheet | null> {
    const endOperation = this.logger.startOperation('setActive', {
      spreadsheet_id: spreadsheetId,
      sheet_name: sheetName,
      is_active: isActive
    });

    try {
      this.logger.logDbOperation('UPDATE', 'spreadsheets', {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        is_active: isActive
      });

      const [updatedSpreadsheet] = await knex<Spreadsheet>('spreadsheets')
        .where({ spreadsheet_id: spreadsheetId, sheet_name: sheetName })
        .update({
          is_active: isActive,
          updated_at: new Date(),
        })
        .returning('*');

      this.logger.info(`Spreadsheet ${isActive ? 'активирован' : 'деактивирован'}`, {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        updated: !!updatedSpreadsheet
      });
      endOperation();
      return updatedSpreadsheet || null;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, `Ошибка при изменении статуса активности для spreadsheet ${spreadsheetId} и листа ${sheetName}`, {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        is_active: isActive
      });
      throw new Error(`Не удалось изменить статус активности: ${(error as Error).message}`);
    }
  }
}

// Экспорт экземпляра сервиса для использования в приложении
export const spreadsheetService = new SpreadsheetService();

// Экспорт по умолчанию для удобства
export default SpreadsheetService;