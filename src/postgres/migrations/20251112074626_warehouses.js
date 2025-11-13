/**
 * @param {import("knex").Knex} knex
 * @returns {Promise<void>}
 */
export async function up(knex) {
    // Создание таблицы
    await knex.schema.createTable("warehouses", (table) => {
        table.increments("id").primary();
        table.text("warehouse_name").notNullable().unique();
        table.text("geo_name").nullable();
        table.timestamp("created_at").defaultTo(knex.fn.now());
        table.timestamp("updated_at").defaultTo(knex.fn.now());

        // Индекс на geo_name
        table.index("geo_name", "idx_warehouses_geo_name");
    });

    // Создание функции для триггера updated_at
    await knex.raw(`
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = CURRENT_TIMESTAMP;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    `);

    // Создание триггера
    await knex.raw(`
        CREATE TRIGGER update_warehouses_updated_at
            BEFORE UPDATE ON warehouses
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
    await knex.raw("DROP TRIGGER IF EXISTS update_warehouses_updated_at ON warehouses");

    // Удаление таблицы (функция остается для других таблиц)
    await knex.schema.dropTableIfExists("warehouses");
}
