/**
 * Пустой seed файл для предотвращения ошибки сканирования директории
 */
import { Knex } from 'knex';

export async function seed(knex: Knex) {
  // Ничего не делаем - просто пустой seed
  console.log('Empty seed executed successfully');
}