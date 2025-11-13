import knex from "#postgres/knex.js";
import { migrate, seed } from "#postgres/knex.js";
import { Command } from "commander";
import type { Knex } from "knex";

/**
 * Вспомогательные утилиты для работы с knex и базой данных
 */

/**
 * Выполняет транзакцию с автоматическим коммитом или откатом
 * @param callback - функция, выполняемая в рамках транзакции
 * @returns Promise<T> - результат выполнения callback
 */
export async function withTransaction<T>(callback: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return await knex.transaction(callback);
}

/**
 * Проверяет существование таблицы в базе данных
 * @param tableName - имя таблицы
 * @returns Promise<boolean> - true, если таблица существует
 */
export async function tableExists(tableName: string): Promise<boolean> {
    const result = await knex.raw(`
        SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = ?
        )
    `, [tableName]);

    return result.rows[0].exists;
}

/**
 * Проверяет существование записи в таблице по условию
 * @param tableName - имя таблицы
 * @param conditions - объект с условиями поиска
 * @returns Promise<boolean> - true, если запись существует
 */
export async function recordExists(tableName: string, conditions: Record<string, any>): Promise<boolean> {
    const query = knex(tableName).where(conditions).first();
    const result = await query;
    return !!result;
}

/**
 * Получает количество записей в таблице по условию
 * @param tableName - имя таблицы
 * @param conditions - объект с условиями поиска (опционально)
 * @returns Promise<number> - количество записей
 */
export async function countRecords(tableName: string, conditions?: Record<string, any>): Promise<number> {
    let query = knex(tableName).count('* as count');

    if (conditions) {
        query = query.where(conditions);
    }

    const result = await query;
    return parseInt(String(result[0].count), 10);
}

/**
 * Выполняет пакетную вставку записей с обработкой конфликтов
 * @param tableName - имя таблицы
 * @param records - массив записей для вставки
 * @param conflictColumns - массив колонок для проверки конфликта
 * @param updateColumns - массив колонок для обновления при конфликте (опционально)
 * @returns Promise<any> - результат операции
 */
export async function batchUpsert(
    tableName: string,
    records: any[],
    conflictColumns: string[],
    updateColumns?: string[]
): Promise<any> {
    if (records.length === 0) {
        return [];
    }

    const conflictClause = conflictColumns.join(', ');
    let updateClause = '';

    if (updateColumns && updateColumns.length > 0) {
        updateClause = updateColumns.map(col => `${col} = EXCLUDED.${col}`).join(', ');
    } else {
        // Если не указаны колонки для обновления, обновляем все кроме ключевых и системных
        const firstRecord = records[0];
        const allColumns = Object.keys(firstRecord);
        const excludeColumns = [...conflictColumns, 'created_at'];
        const columnsToUpdate = allColumns.filter(col => !excludeColumns.includes(col));

        if (columnsToUpdate.length > 0) {
            updateClause = columnsToUpdate.map(col => `${col} = EXCLUDED.${col}`).join(', ');
        }
    }

    // Добавляем обновление updated_at, если оно есть в таблице
    if (updateClause) {
        updateClause += ', updated_at = CURRENT_TIMESTAMP';
    } else {
        updateClause = 'updated_at = CURRENT_TIMESTAMP';
    }

    const query = `
        INSERT INTO ${tableName} (${Object.keys(records[0]).join(', ')})
        VALUES ${records.map(() => '(?)').join(', ')}
        ON CONFLICT (${conflictClause})
        DO UPDATE SET ${updateClause}
        RETURNING *
    `;

    const values = records.map(record => Object.values(record));
    const flattenedValues = values.flat();

    return await knex.raw(query, flattenedValues);
}

/**
 * Очищает таблицу и сбрасывает счетчик автоинкремента
 * @param tableName - имя таблицы
 * @returns Promise<void>
 */
export async function truncateTable(tableName: string): Promise<void> {
    await knex.raw(`TRUNCATE TABLE ${tableName} RESTART IDENTITY CASCADE`);
}

/**
 * Получает список всех таблиц в текущей схеме
 * @returns Promise<string[]> - массив имен таблиц
 */
export async function getTableNames(): Promise<string[]> {
    const result = await knex.raw(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        ORDER BY table_name
    `);

    return result.rows.map((row: any) => row.table_name);
}

// CLI утилиты для миграций и сидов
const program = new Command();

program
    .command("migrate")
    .argument("[type]", "latest|rollback|status|down|up|list")
    .argument("[arg]", "version")
    .action(async (action, arg) => {
        if (!action) return;
        if (action === "latest") await migrate.latest();
        if (action === "rollback") await migrate.rollback();
        if (action === "down") await migrate.down(arg);
        if (action === "up") await migrate.up(arg);
        if (action === "list") await migrate.list();
        if (action === "make") await migrate.make(arg);
        process.exit(0);
    });
program.command("seed [action] [arg]").action(async (action, arg) => {
    if (!action) return;
    if (action === "run") await seed.run();
    if (action === "make") await seed.make(arg);
    process.exit(0);
});
program.command("default", { isDefault: true }).action(() => {});
program.parse();
