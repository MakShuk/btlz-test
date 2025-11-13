/**
 * @param {import("knex").Knex} knex
 * @returns {Promise<void>}
 */
export async function up(knex) {
    // Добавление поля sorting_coefficient в таблицу box_tariffs
    await knex.schema.alterTable("box_tariffs", (table) => {
        table.decimal("sorting_coefficient", 10, 2).nullable().comment("Коэффициент сортировки для тарифов");
    });
}

/**
 * @param {import("knex").Knex} knex
 * @returns {Promise<void>}
 */
export async function down(knex) {
    // Удаление поля sorting_coefficient из таблицы box_tariffs
    await knex.schema.alterTable("box_tariffs", (table) => {
        table.dropColumn("sorting_coefficient");
    });
}