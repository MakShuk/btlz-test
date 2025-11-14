/**
 * @param {import("knex").Knex} knex
 * @returns {Promise<void>}
 */
exports.seed = async function(knex) {
    // Очищаем таблицу перед заполнением
    await knex("spreadsheets").del();
}