/**
 * @param {import("knex").Knex} knex
 * @returns {Promise<void>}
 */
export async function up(knex) {
    // Создание таблицы
    await knex.schema.createTable("box_tariffs", (table) => {
        table.increments("id").primary();

        // Связь с warehouses
        table.integer("warehouse_id").notNullable()
            .references("id")
            .inTable("warehouses")
            .onDelete("CASCADE");

        table.date("tariff_date").notNullable();

        // Тарифы доставки FBO
        table.decimal("box_delivery_base", 10, 2).nullable();
        table.decimal("box_delivery_liter", 10, 2).nullable();
        table.decimal("box_delivery_coef_expr", 10, 2).nullable();

        // Тарифы доставки FBS
        table.decimal("box_delivery_marketplace_base", 10, 2).nullable();
        table.decimal("box_delivery_marketplace_liter", 10, 2).nullable();
        table.decimal("box_delivery_marketplace_coef_expr", 10, 2).nullable();

        // Тарифы хранения
        table.decimal("box_storage_base", 10, 2).nullable();
        table.decimal("box_storage_liter", 10, 2).nullable();
        table.decimal("box_storage_coef_expr", 10, 2).nullable();

        // Метаданные
        table.text("dt_next_box").nullable();
        table.date("dt_till_max").nullable();

        // Системные поля
        table.timestamp("created_at").defaultTo(knex.fn.now());
        table.timestamp("updated_at").defaultTo(knex.fn.now());

        // Уникальный constraint на (warehouse_id, tariff_date)
        table.unique(["warehouse_id", "tariff_date"], {
            indexName: "uq_warehouse_date"
        });

        // Индексы
        table.index("tariff_date", "idx_box_tariffs_date");
        table.index("warehouse_id", "idx_box_tariffs_warehouse");
        table.index(["warehouse_id", "tariff_date"], "idx_box_tariffs_warehouse_date");
    });

    // Создание триггера для updated_at
    await knex.raw(`
        CREATE TRIGGER update_box_tariffs_updated_at
            BEFORE UPDATE ON box_tariffs
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
    await knex.raw("DROP TRIGGER IF EXISTS update_box_tariffs_updated_at ON box_tariffs");

    // Удаление таблицы
    await knex.schema.dropTableIfExists("box_tariffs");
}