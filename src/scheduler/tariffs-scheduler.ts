import cron, { ScheduledTask } from 'node-cron';
import { TariffsUpdater } from '../services/tariffs-updater.js';
import { getSchedulerLogger } from '../utils/logger.js';

/**
 * TariffsScheduler - Планировщик автоматического обновления тарифов
 *
 * Реализует планирование ежечасного обновления тарифов Wildberries
 * с использованием node-cron. Поддерживает:
 * - Автоматический запуск по расписанию (каждый час)
 * - Ручной запуск через runNow()
 * - Graceful shutdown через stop()
 * - Детальное логирование всех операций
 * - Обработка ошибок с продолжением работы планировщика
 */
export class TariffsScheduler {
  private task: ScheduledTask | null = null;
  private tariffsUpdater: TariffsUpdater;
  private logger = getSchedulerLogger('TariffsScheduler');
  private isRunning = false;
  private cronExpression = '0 * * * *'; // Каждый час в начале часа
  private timezone = 'Europe/Moscow';

  constructor(tariffsUpdater?: TariffsUpdater) {
    this.tariffsUpdater = tariffsUpdater || new TariffsUpdater();
  }

  /**
   * Запуск планировщика
   *
   * Создает и запускает cron задачу с расписанием '0 * * * *' (каждый час).
   * Если задача уже запущена, логирует предупреждение и не создает новую.
   *
   * @example
   * const scheduler = new TariffsScheduler();
   * scheduler.start();
   */
  start(): void {
    if (this.task) {
      this.logger.warn('Планировщик уже запущен', {
        cronExpression: this.cronExpression,
        timezone: this.timezone
      });
      return;
    }

    this.logger.info('Инициализация планировщика тарифов', {
      cronExpression: this.cronExpression,
      timezone: this.timezone,
      description: 'Каждый час в начале часа'
    });

    try {
      // Создание cron задачи
      this.task = cron.schedule(
        this.cronExpression,
        async () => {
          await this.executeScheduledTask();
        },
        {
          timezone: this.timezone
        }
      );

      this.isRunning = true;
      this.logger.info('Планировщик успешно запущен', {
        cronExpression: this.cronExpression,
        timezone: this.timezone,
        nextRun: this.getNextRunTime()
      });
    } catch (error) {
      this.logger.logError(
        error as Error,
        'Ошибка при запуске планировщика',
        {
          cronExpression: this.cronExpression,
          timezone: this.timezone
        }
      );
      throw error;
    }
  }

  /**
   * Остановка планировщика
   *
   * Корректно останавливает cron задачу и освобождает ресурсы.
   * Используется для graceful shutdown приложения.
   *
   * @example
   * process.on('SIGTERM', () => {
   *   scheduler.stop();
   * });
   */
  stop(): void {
    if (!this.task) {
      this.logger.warn('Планировщик не запущен, нечего останавливать');
      return;
    }

    this.logger.info('Остановка планировщика тарифов');

    try {
      this.task.stop();
      this.task = null;
      this.isRunning = false;

      this.logger.info('Планировщик успешно остановлен');
    } catch (error) {
      this.logger.logError(
        error as Error,
        'Ошибка при остановке планировщика'
      );
      throw error;
    }
  }

  /**
   * Ручной запуск обновления тарифов
   *
   * Выполняет обновление тарифов немедленно, независимо от расписания.
   * Полезно для тестирования и восстановления данных.
   *
   * @returns Promise<void>
   *
   * @example
   * const scheduler = new TariffsScheduler();
   * await scheduler.runNow(); // Запуск вручную
   */
  async runNow(): Promise<void> {
    this.logger.info('Ручной запуск обновления тарифов');

    try {
      await this.executeScheduledTask();
      this.logger.info('Ручное обновление завершено успешно');
    } catch (error) {
      this.logger.logError(
        error as Error,
        'Ошибка при ручном обновлении'
      );
      throw error;
    }
  }

  /**
   * Проверка статуса планировщика
   *
   * @returns true если планировщик запущен, false иначе
   */
  isSchedulerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Получение времени следующего запуска
   *
   * @returns Строка с описанием следующего запуска или null
   */
  getNextRunTime(): string | null {
    if (!this.isRunning) {
      return null;
    }

    // Вычисляем следующий час
    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setHours(nextRun.getHours() + 1);
    nextRun.setMinutes(0);
    nextRun.setSeconds(0);
    nextRun.setMilliseconds(0);

    return nextRun.toISOString();
  }

  /**
   * Выполнение запланированной задачи обновления
   *
   * Внутренний метод, вызываемый по расписанию cron.
   * Обрабатывает все ошибки, чтобы планировщик продолжал работать.
   */
  private async executeScheduledTask(): Promise<void> {
    const taskId = Date.now();
    const endOperation = this.logger.startOperation('executeScheduledTask', { taskId });

    this.logger.info('Начало запланированного обновления тарифов', {
      taskId,
      timestamp: new Date().toISOString()
    });

    try {
      // Вызов бизнес-логики обновления
      const result = await this.tariffsUpdater.updateAllTariffs();

      // Логирование результата
      if (result.success) {
        this.logger.info('Запланированное обновление завершено успешно', {
          taskId,
          date: result.date,
          warehousesProcessed: result.warehousesProcessed,
          tariffsProcessed: result.tariffsProcessed,
          duration: result.duration,
          nextRun: this.getNextRunTime()
        });
      } else {
        this.logger.warn('Запланированное обновление завершено с ошибками', {
          taskId,
          date: result.date,
          warehousesProcessed: result.warehousesProcessed,
          tariffsProcessed: result.tariffsProcessed,
          errorsCount: result.errors.length,
          errors: result.errors,
          duration: result.duration,
          nextRun: this.getNextRunTime()
        });
      }

      endOperation();
    } catch (error) {
      endOperation();

      // Критическая ошибка - логируем, но не останавливаем планировщик
      this.logger.logError(
        error as Error,
        'Критическая ошибка при выполнении запланированной задачи',
        {
          taskId,
          timestamp: new Date().toISOString(),
          nextRun: this.getNextRunTime()
        }
      );

      // Проверяем, не является ли это ошибкой авторизации (401)
      if (error instanceof Error && error.message.includes('401')) {
        this.logger.error(
          'Обнаружена ошибка авторизации (401). Проверьте WB_API_TOKEN в .env файле',
          {
            taskId,
            recommendation: 'Планировщик продолжит работу, но обновления будут неудачными до исправления токена'
          }
        );
      }

      // Планировщик продолжает работать, ожидая следующего часа
      this.logger.info('Планировщик продолжает работу, следующая попытка по расписанию', {
        nextRun: this.getNextRunTime()
      });
    }
  }

  /**
   * Получение информации о планировщике
   *
   * @returns Объект с информацией о состоянии планировщика
   */
  getSchedulerInfo() {
    return {
      isRunning: this.isRunning,
      cronExpression: this.cronExpression,
      timezone: this.timezone,
      nextRun: this.getNextRunTime(),
      description: 'Автоматическое обновление тарифов Wildberries каждый час'
    };
  }
}

// Экспорт экземпляра для использования в приложении
export const tariffsScheduler = new TariffsScheduler();

// Экспорт по умолчанию
export default TariffsScheduler;