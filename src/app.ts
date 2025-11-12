import knex, { migrate, seed } from "#postgres/knex.js";
import { tariffsScheduler } from './scheduler/tariffs-scheduler.js';
import { TariffsUpdater } from './services/tariffs-updater.js';
import { logger } from './utils/logger.js';

/**
 * Инициализация приложения
 */
async function startApp() {
  try {
    logger.info('Запуск приложения');

    // Запуск миграций
    logger.info('Применение миграций базы данных');
    await migrate.latest();
    logger.info('Миграции успешно применены');

    // Запуск seed данных
    logger.info('Запуск seed данных');
    await seed.run();
    logger.info('Seed данные успешно загружены');

    // Запуск первоначального обновления тарифов
    logger.info('Запуск первоначального обновления тарифов');
    try {
      const tariffsUpdater = new TariffsUpdater();
      const initialUpdateResult = await tariffsUpdater.updateAllTariffs();

      if (initialUpdateResult) {
        if (initialUpdateResult.success) {
          logger.info('Первоначальное обновление тарифов завершено успешно', {
            warehousesProcessed: initialUpdateResult.warehousesProcessed,
            tariffsProcessed: initialUpdateResult.tariffsProcessed,
            duration: initialUpdateResult.duration
          });
        } else {
          logger.warn('Первоначальное обновление тарифов завершено с ошибками', {
            errorsCount: initialUpdateResult.errors.length,
            errors: initialUpdateResult.errors
          });
        }
      } else {
        logger.error('Первоначальное обновление тарифов вернуло неопределенный результат');
      }
    } catch (error) {
      logger.logError(error as Error, 'Ошибка при первоначальном обновлении тарифов');
      // Не прерываем запуск приложения, а продолжаем с планировщиком
    }

    // Запуск планировщика тарифов
    logger.info('Запуск планировщика автоматического обновления тарифов');
    tariffsScheduler.start();

    const schedulerInfo = tariffsScheduler.getSchedulerInfo();
    logger.info('Планировщик успешно запущен', {
      cronExpression: schedulerInfo.cronExpression,
      timezone: schedulerInfo.timezone,
      nextRun: schedulerInfo.nextRun,
      description: schedulerInfo.description
    });

    logger.info('Приложение успешно запущено и готово к работе');

  } catch (error) {
    logger.logError(error as Error, 'Критическая ошибка при запуске приложения');
    process.exit(1);
  }
}

/**
 * Graceful shutdown приложения
 */
async function shutdown(signal: string) {
  logger.info(`Получен сигнал ${signal}, начало graceful shutdown`);

  try {
    // Остановка планировщика
    logger.info('Остановка планировщика тарифов');
    tariffsScheduler.stop();
    logger.info('Планировщик успешно остановлен');

    // Закрытие соединения с базой данных
    logger.info('Закрытие соединения с базой данных');
    await knex.destroy();
    logger.info('Соединение с базой данных закрыто');

    logger.info('Graceful shutdown завершен успешно');
    process.exit(0);
  } catch (error) {
    logger.logError(error as Error, 'Ошибка при graceful shutdown');
    process.exit(1);
  }
}

// Обработчики сигналов для graceful shutdown
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Обработка необработанных ошибок
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Необработанное отклонение Promise', {
    reason: String(reason),
    promise: String(promise)
  });
});

process.on('uncaughtException', (error) => {
  logger.logError(error, 'Необработанное исключение');
  shutdown('uncaughtException');
});

// Запуск приложения
startApp();