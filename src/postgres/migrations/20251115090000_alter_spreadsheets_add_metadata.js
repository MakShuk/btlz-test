/**
 * @param {import("knex").Knex} knex
 * @returns {Promise<void>}
 */
export async function up(knex) {
    // Добавляем новые колонки в таблицу spreadsheets
    await knex.schema.alterTable("spreadsheets", (table) => {
        // Основные поля - сначала добавляем sheet_name как nullable
        table.string("sheet_name").nullable();
        table.text("description").nullable();
        table.boolean("is_active").notNullable().defaultTo(true);
        table.timestamp("last_synced_at", { useTz: true }).nullable();
        table.string("credentials_ref").nullable();

        // Системные поля
        table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    // Обновляем существующие записи, устанавливая значения по умолчанию для sheet_name
    await knex.raw(`
        UPDATE spreadsheets
        SET sheet_name = COALESCE(sheet_name, spreadsheet_id)
        WHERE sheet_name IS NULL
    `);

    // Теперь изменяем sheet_name на NOT NULL
    await knex.schema.alterTable("spreadsheets", (table) => {
        table.string("sheet_name").notNullable().alter();
    });

    // Добавляем индексы и ограничения
    await knex.schema.alterTable("spreadsheets", (table) => {
        // Уникальный индекс на (spreadsheet_id, sheet_name)
        table.unique(["spreadsheet_id", "sheet_name"], {
            indexName: "uq_spreadsheets_id_sheet_name"
        });

        // Индексы для is_active и last_synced_at
        table.index("is_active", "idx_spreadsheets_is_active");
        table.index("last_synced_at", "idx_spreadsheets_last_synced_at");
    });

    // Создание триггера для обновления updated_at
    // Функция уже существует в миграции warehouses, используем её
    await knex.raw(`
        CREATE TRIGGER update_spreadsheets_updated_at
            BEFORE UPDATE ON spreadsheets
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    `);
}

/**
 * @param {import("knex").Knex} knex
 * @returns {Promise<void>}
 */
export async function down(knex) {
    // Удаление триггера
    await knex.raw("DROP TRIGGER IF EXISTS update_spreadsheets_updated_at ON spreadsheets");

    // Удаление индексов и ограничений
    await knex.schema.alterTable("spreadsheets", (table) => {
        table.dropIndex([], "idx_spreadsheets_is_active");
        table.dropIndex([], "idx_spreadsheets_last_synced_at");
        table.dropUnique([], "uq_spreadsheets_id_sheet_name");
    });

    // Удаление колонок в обратном порядке
    await knex.schema.alterTable("spreadsheets", (table) => {
        table.dropColumn("updated_at");
        table.dropColumn("created_at");
        table.dropColumn("credentials_ref");
        table.dropColumn("last_synced_at");
        table.dropColumn("is_active");
        table.dropColumn("description");
        table.dropColumn("sheet_name");
    });
}