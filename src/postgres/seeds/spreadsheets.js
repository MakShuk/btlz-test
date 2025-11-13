/**
 * @param {import("knex").Knex} knex
 * @returns {Promise<void>}
 */
export async function seed(knex) {
    // Очищаем таблицу перед заполнением
    await knex("spreadsheets").del();

    // Заполняем тестовыми данными
    await knex("spreadsheets")
        .insert([
            {
                spreadsheet_id: "warehouse_tariffs_2024",
                sheet_name: "Москва",
                description: "Тарифы на доставку для складов в Москве и Московской области",
                is_active: true,
                last_synced_at: null,
                credentials_ref: null,
                created_at: knex.fn.now(),
                updated_at: knex.fn.now()
            },
            {
                spreadsheet_id: "warehouse_tariffs_2024",
                sheet_name: "Санкт-Петербург",
                description: "Тарифы на доставку для складов в Санкт-Петербурге и Ленинградской области",
                is_active: true,
                last_synced_at: null,
                credentials_ref: null,
                created_at: knex.fn.now(),
                updated_at: knex.fn.now()
            },
            {
                spreadsheet_id: "warehouse_tariffs_2024",
                sheet_name: "Екатеринбург",
                description: "Тарифы на доставку для складов в Екатеринбурге и Свердловской области",
                is_active: true,
                last_synced_at: null,
                credentials_ref: null,
                created_at: knex.fn.now(),
                updated_at: knex.fn.now()
            },
            {
                spreadsheet_id: "box_tariffs_2024",
                sheet_name: "Стандартные коробки",
                description: "Тарифы на упаковку стандартных коробок разных размеров",
                is_active: true,
                last_synced_at: null,
                credentials_ref: null,
                created_at: knex.fn.now(),
                updated_at: knex.fn.now()
            },
            {
                spreadsheet_id: "box_tariffs_2024",
                sheet_name: "Крупногабаритные коробки",
                description: "Тарифы на упаковку крупногабаритных коробок и специальных упаковок",
                is_active: true,
                last_synced_at: null,
                credentials_ref: null,
                created_at: knex.fn.now(),
                updated_at: knex.fn.now()
            }
        ])
        .onConflict(["spreadsheet_id", "sheet_name"])
        .merge();
}
