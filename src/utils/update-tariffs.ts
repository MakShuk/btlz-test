#!/usr/bin/env node

import { Command } from 'commander';
import { TariffsUpdater } from '../services/tariffs-updater.js';
import { getServiceLogger } from './logger.js';

const logger = getServiceLogger('CLI-UpdateTariffs');

/**
 * CLI утилита для ручного обновления тарифов Wildberries
 *
 * Использование:
 * npm run update-tariffs:dev -- update --date 2025-11-12
 * npm run update-tariffs:dev -- update --date today
 */

/**
 * Валидация формата даты YYYY-MM-DD
 */
function isValidDateFormat(dateString: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) {
    return false;
  }

  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Получение текущей даты в московском часовом поясе (UTC+3)
 */
function getCurrentDateInMoscow(): string {
  const now = new Date();
  // Получаем время в UTC+3 (Москва)
  const moscowTime = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return moscowTime.toISOString().split('T')[0];
}

/**
 * Форматирование длительности в читаемый вид
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}мс`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}с`;
  return `${(ms / 60000).toFixed(2)}мин`;
}

/**
 * Команда обновления тарифов за указанную дату
 */
async function updateCommand(dateOption: string) {
  let date: string;

  // Обработка специального значения "today"
  if (dateOption.toLowerCase() === 'today') {
    date = getCurrentDateInMoscow();
    logger.info(`Используется текущая дата: ${date}`);
  } else {
    date = dateOption;
  }

  // Валидация формата даты
  if (!isValidDateFormat(date)) {
    logger.error(`❌ Неверный формат даты: ${date}`);
    logger.error('Формат должен быть YYYY-MM-DD (например: 2025-11-12) или "today"');
    process.exit(1);
  }

  logger.info(`🚀 Начало обновления тарифов за ${date}`);
  console.log('━'.repeat(60));

  try {
    const updater = new TariffsUpdater();
    const result = await updater.updateTariffsForDate(date);

    console.log('━'.repeat(60));

    if (result.success) {
      logger.info(`✅ Обновление завершено успешно`);
      console.log(`\n📊 Статистика:`);
      console.log(`   Дата: ${result.date}`);
      console.log(`   Складов обработано: ${result.warehousesProcessed}`);
      console.log(`   Тарифов обработано: ${result.tariffsProcessed}`);
      console.log(`   Длительность: ${formatDuration(result.duration)}`);

      if (result.errors.length > 0) {
        logger.warn(`⚠️  Обнаружены незначительные ошибки (${result.errors.length}):`);
        result.errors.forEach((error, index) => {
          console.log(`   ${index + 1}. ${error}`);
        });
      }

      process.exit(0);
    } else {
      logger.error(`❌ Обновление завершено с ошибками`);
      console.log(`\n📊 Статистика:`);
      console.log(`   Дата: ${result.date}`);
      console.log(`   Складов обработано: ${result.warehousesProcessed}`);
      console.log(`   Тарифов обработано: ${result.tariffsProcessed}`);
      console.log(`   Длительность: ${formatDuration(result.duration)}`);
      console.log(`\n❌ Ошибки (${result.errors.length}):`);
      result.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });

      process.exit(1);
    }
  } catch (error) {
    logger.logError(error as Error, '💥 Критическая ошибка при выполнении команды', { date });
    console.error(`\n❌ Критическая ошибка: ${(error as Error).message}`);
    process.exit(1);
  }
}

// Настройка CLI программы
const program = new Command();

program
  .name('update-tariffs')
  .description('CLI утилита для ручного обновления тарифов Wildberries')
  .version('1.0.0');

program
  .command('update')
  .description('Обновить тарифы за указанную дату')
  .requiredOption('-d, --date <YYYY-MM-DD>', 'Дата в формате YYYY-MM-DD или "today"')
  .action(async (options) => {
    await updateCommand(options.date);
  });

// Обработка случая, когда команда не указана
program.on('command:*', () => {
  logger.error('❌ Неизвестная команда');
  logger.info('Используйте --help для просмотра доступных команд');
  process.exit(1);
});

// Если аргументы не переданы, показываем help
if (process.argv.length === 2) {
  program.help();
}

// Запуск парсинга аргументов
program.parse(process.argv);