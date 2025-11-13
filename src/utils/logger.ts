import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Уровни логирования
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
}

// Категории логирования
export enum LogCategory {
  API = 'api',
  DATABASE = 'database',
  SERVICE = 'service',
  SCHEDULER = 'scheduler',
  GENERAL = 'general',
  GOOGLE_SHEETS = 'google_sheets',
  METRICS = 'metrics',
  ALERTS = 'alerts',
}

// Интерфейс для структурированных логов
export interface LogMetadata {
  category?: LogCategory;
  component?: string;
  method?: string;
  duration?: number;
  error?: Error | string;
  correlationId?: string;
  operationType?: string;
  rowsCount?: number;
  spreadsheetId?: string;
  sheetName?: string;
  retryCount?: number;
  [key: string]: any;
}

// Интерфейс для метрик операций
export interface OperationMetrics {
  operationType: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  success: boolean;
  errorCount: number;
  rowsProcessed?: number;
  spreadsheetId?: string;
  sheetName?: string;
  retryCount?: number;
}

// Интерфейс для алертов
export interface AlertConfig {
  operationType: string;
  errorThreshold: number;
  durationThreshold: number;
  timeWindow: number; // в миллисекундах
}

// Интерфейс для счётчика ошибок
export interface ErrorCounter {
  [operationType: string]: {
    count: number;
    lastError: Date;
    errors: Array<{
      timestamp: Date;
      error: string;
      correlationId?: string;
    }>;
  };
}

/**
 * Класс для управления метриками операций
 */
class MetricsManager {
  private metrics: Map<string, OperationMetrics> = new Map();

  startOperation(operationType: string, correlationId?: string, metadata?: LogMetadata): string {
    const id = correlationId || this.generateCorrelationId();
    const startTime = Date.now();

    const metric: OperationMetrics = {
      operationType,
      startTime,
      success: false,
      errorCount: 0,
      ...metadata,
    };

    this.metrics.set(id, metric);

    return id;
  }

  endOperation(correlationId: string, success: boolean, errorCount: number = 0): OperationMetrics | null {
    const metric = this.metrics.get(correlationId);
    if (!metric) return null;

    metric.endTime = Date.now();
    metric.duration = metric.endTime - metric.startTime;
    metric.success = success;
    metric.errorCount = errorCount;

    this.metrics.delete(correlationId);
    return metric;
  }

  getActiveOperations(): Map<string, OperationMetrics> {
    return new Map(this.metrics);
  }

  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Класс для управления счётчиками ошибок
 */
class ErrorCounterManager {
  private counters: ErrorCounter = {};
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Очистка старых ошибок каждые 5 минут
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  incrementError(operationType: string, error: string, correlationId?: string): void {
    if (!this.counters[operationType]) {
      this.counters[operationType] = {
        count: 0,
        lastError: new Date(),
        errors: [],
      };
    }

    this.counters[operationType].count++;
    this.counters[operationType].lastError = new Date();
    this.counters[operationType].errors.push({
      timestamp: new Date(),
      error,
      correlationId,
    });

    // Храним только последние 50 ошибок для каждого типа
    if (this.counters[operationType].errors.length > 50) {
      this.counters[operationType].errors.shift();
    }
  }

  getErrorCount(operationType: string, timeWindow?: number): number {
    if (!this.counters[operationType]) return 0;

    if (!timeWindow) return this.counters[operationType].count;

    const cutoffTime = new Date(Date.now() - timeWindow);
    return this.counters[operationType].errors.filter(
      error => error.timestamp >= cutoffTime
    ).length;
  }

  getLastError(operationType: string): Date | null {
    return this.counters[operationType]?.lastError || null;
  }

  getRecentErrors(operationType: string, limit: number = 10): Array<{
    timestamp: Date;
    error: string;
    correlationId?: string;
  }> {
    if (!this.counters[operationType]) return [];

    return this.counters[operationType].errors
      .slice(-limit)
      .reverse();
  }

  private cleanup(): void {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 часа

    Object.keys(this.counters).forEach(operationType => {
      this.counters[operationType].errors = this.counters[operationType].errors.filter(
        error => error.timestamp >= cutoffTime
      );

      if (this.counters[operationType].errors.length === 0) {
        delete this.counters[operationType];
      }
    });
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

/**
 * Класс для управления алертами
 */
class AlertManager {
  private alerts: Map<string, AlertConfig> = new Map();
  private alertCallbacks: Array<(alert: AlertData) => void> = [];

  constructor() {
    this.setupDefaultAlerts();
  }

  private setupDefaultAlerts(): void {
    // Алерт для Google Sheets операций
    this.addAlertConfig('google_sheets_sync', {
      operationType: 'google_sheets_sync',
      errorThreshold: 3,
      durationThreshold: 30000, // 30 секунд
      timeWindow: 5 * 60 * 1000, // 5 минут
    });

    // Алерт для API операций
    this.addAlertConfig('api_request', {
      operationType: 'api_request',
      errorThreshold: 5,
      durationThreshold: 10000, // 10 секунд
      timeWindow: 5 * 60 * 1000, // 5 минут
    });

    // Алерт для операций с базой данных
    this.addAlertConfig('database_operation', {
      operationType: 'database_operation',
      errorThreshold: 2,
      durationThreshold: 5000, // 5 секунд
      timeWindow: 5 * 60 * 1000, // 5 минут
    });
  }

  addAlertConfig(name: string, config: AlertConfig): void {
    this.alerts.set(name, config);
  }

  checkAlerts(
    operationType: string,
    metric: OperationMetrics,
    errorCounter: ErrorCounterManager
  ): void {
    const alertConfigs = Array.from(this.alerts.values()).filter(
      config => config.operationType === operationType
    );

    for (const config of alertConfigs) {
      const errorCount = errorCounter.getErrorCount(
        operationType,
        config.timeWindow
      );

      const shouldAlertError = errorCount >= config.errorThreshold;
      const shouldAlertDuration = metric.duration && metric.duration >= config.durationThreshold;

      if (shouldAlertError || shouldAlertDuration) {
        const alertData: AlertData = {
          type: shouldAlertError ? 'error_threshold' : 'duration_threshold',
          operationType,
          threshold: shouldAlertError ? config.errorThreshold : config.durationThreshold,
          currentValue: shouldAlertError ? errorCount : (metric.duration || 0),
          timeWindow: config.timeWindow,
          timestamp: new Date(),
          correlationId: metric.startTime.toString(),
        };

        this.triggerAlert(alertData);
      }
    }
  }

  addAlertCallback(callback: (alert: AlertData) => void): void {
    this.alertCallbacks.push(callback);
  }

  private triggerAlert(alert: AlertData): void {
    this.alertCallbacks.forEach(callback => {
      try {
        callback(alert);
      } catch (error) {
        console.error('Error in alert callback:', error);
      }
    });
  }
}

// Интерфейс для данных алерта
export interface AlertData {
  type: 'error_threshold' | 'duration_threshold';
  operationType: string;
  threshold: number;
  currentValue: number;
  timeWindow: number;
  timestamp: Date;
  correlationId: string;
}

// Получение уровня логирования из переменных окружения
const getLogLevel = (): string => {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  if (level && Object.values(LogLevel).includes(level as LogLevel)) {
    return level;
  }
  return process.env.NODE_ENV === 'production' ? LogLevel.ERROR : LogLevel.INFO;
};

// Получение пути к директории с логами
const getLogsDirectory = (): string => {
  return process.env.LOGS_DIR || path.join(process.cwd(), 'logs');
};

// Формат для консоли с цветами
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, category, component, method, ...meta }) => {
    let logMessage = `${timestamp} [${level}]`;

    if (category) {
      logMessage += ` [${category}]`;
    }

    if (component) {
      logMessage += ` [${component}]`;
    }

    if (method) {
      logMessage += ` [${method}]`;
    }

    logMessage += `: ${message}`;

    // Добавляем метаданные если они есть
    const metaKeys = Object.keys(meta).filter(key =>
      !['timestamp', 'level', 'message', 'category', 'component', 'method'].includes(key)
    );

    if (metaKeys.length > 0) {
      const metaObj: any = {};
      metaKeys.forEach(key => {
        metaObj[key] = meta[key];
      });
      logMessage += ` ${JSON.stringify(metaObj)}`;
    }

    return logMessage;
  })
);

// Формат для файлов (JSON)
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Создание транспортов
const createTransports = () => {
  const logsDir = getLogsDirectory();
  const transports: winston.transport[] = [];

  // Консоль (всегда включена)
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );

  // Включаем файловые логи только если включены явно
  if (process.env.LOGS_TO_FILE === 'true') {
    // Общий лог файл с ротацией
    transports.push(
      new DailyRotateFile({
        filename: path.join(logsDir, 'application-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '10m',
        maxFiles: '14d',
        format: fileFormat,
      })
    );

    // Отдельный файл для ошибок
    transports.push(
      new DailyRotateFile({
        filename: path.join(logsDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '10m',
        maxFiles: '30d',
        format: fileFormat,
      })
    );

    // Отдельный файл для API логов
    transports.push(
      new DailyRotateFile({
        filename: path.join(logsDir, 'api-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '10m',
        maxFiles: '14d',
        format: fileFormat,
        level: 'debug',
      })
    );
  }

  return transports;
};

// Создание базового логгера
const baseLogger = winston.createLogger({
  level: getLogLevel(),
  transports: createTransports(),
  exitOnError: false,
});

/**
 * Класс Logger с типизированными методами
 */
export class Logger {
  private category: LogCategory;
  private component?: string;
  private static metricsManager = new MetricsManager();
  private static errorCounter = new ErrorCounterManager();
  private static alertManager = new AlertManager();

  constructor(category: LogCategory = LogCategory.GENERAL, component?: string) {
    this.category = category;
    this.component = component;

    // Настройка алертов по умолчанию
    if (!Logger.alertManager) {
      Logger.setupDefaultAlerts();
    }
  }

  private static setupDefaultAlerts(): void {
    Logger.alertManager.addAlertCallback((alert: AlertData) => {
      const alertLogger = new Logger(LogCategory.ALERTS, 'AlertManager');

      if (alert.type === 'error_threshold') {
        alertLogger.error(`Превышен порог ошибок для операции ${alert.operationType}`, {
          operationType: alert.operationType,
          threshold: alert.threshold,
          currentValue: alert.currentValue,
          timeWindow: alert.timeWindow,
          correlationId: alert.correlationId,
          alertType: alert.type,
        });
      } else if (alert.type === 'duration_threshold') {
        alertLogger.warn(`Превышен порог длительности для операции ${alert.operationType}`, {
          operationType: alert.operationType,
          threshold: alert.threshold,
          currentValue: alert.currentValue,
          timeWindow: alert.timeWindow,
          correlationId: alert.correlationId,
          alertType: alert.type,
        });
      }
    });
  }

  /**
   * Логирование ошибок
   */
  error(message: string, meta?: LogMetadata): void {
    baseLogger.error(message, {
      category: this.category,
      component: this.component,
      ...meta,
    });
  }

  /**
   * Логирование предупреждений
   */
  warn(message: string, meta?: LogMetadata): void {
    baseLogger.warn(message, {
      category: this.category,
      component: this.component,
      ...meta,
    });
  }

  /**
   * Логирование информационных сообщений
   */
  info(message: string, meta?: LogMetadata): void {
    baseLogger.info(message, {
      category: this.category,
      component: this.component,
      ...meta,
    });
  }

  /**
   * Логирование отладочных сообщений
   */
  debug(message: string, meta?: LogMetadata): void {
    baseLogger.debug(message, {
      category: this.category,
      component: this.component,
      ...meta,
    });
  }

  /**
   * Создание дочернего логгера с другим компонентом
   */
  child(component: string): Logger {
    return new Logger(this.category, component);
  }

  /**
   * Логирование начала операции с возвратом функции для логирования завершения
   */
  startOperation(operation: string, meta?: LogMetadata): () => void {
    const startTime = Date.now();
    this.debug(`Начало операции: ${operation}`, meta);

    return () => {
      const duration = Date.now() - startTime;
      this.debug(`Завершение операции: ${operation}`, {
        ...meta,
        duration,
      });
    };
  }

  /**
   * Логирование HTTP запроса
   */
  logRequest(method: string, url: string, meta?: LogMetadata): void {
    this.info(`HTTP ${method} ${url}`, {
      method: 'HTTP',
      ...meta,
    });
  }

  /**
   * Логирование HTTP ответа
   */
  logResponse(method: string, url: string, statusCode: number, duration: number, meta?: LogMetadata): void {
    const level = statusCode >= 400 ? 'warn' : 'info';
    this[level](`HTTP ${method} ${url} - ${statusCode}`, {
      method: 'HTTP',
      statusCode,
      duration,
      ...meta,
    });
  }

  /**
   * Логирование операции с базой данных
   */
  logDbOperation(operation: string, table: string, meta?: LogMetadata): void {
    this.debug(`DB ${operation} on ${table}`, {
      method: 'DATABASE',
      operation,
      table,
      ...meta,
    });
  }

  /**
   * Логирование ошибки с полным стеком
   */
  logError(error: Error, context?: string, meta?: LogMetadata): void {
    // Увеличиваем счётчик ошибок
    const operationType = meta?.operationType || 'unknown';
    Logger.errorCounter.incrementError(
      operationType,
      error.message,
      meta?.correlationId
    );

    this.error(context ? `${context}: ${error.message}` : error.message, {
      error: error.stack || error.message,
      ...meta,
    });
  }

  /**
   * Начало операции с таймером и correlation ID
   */
  startTimedOperation(operationType: string, meta?: LogMetadata): string {
    const correlationId = Logger.metricsManager.startOperation(operationType, undefined, meta);

    this.debug(`Начало операции: ${operationType}`, {
      correlationId,
      operationType,
      ...meta,
    });

    return correlationId;
  }

  /**
   * Завершение операции с таймером
   */
  endTimedOperation(
    correlationId: string,
    success: boolean = true,
    errorCount: number = 0,
    meta?: LogMetadata
  ): OperationMetrics | null {
    const metric = Logger.metricsManager.endOperation(correlationId, success, errorCount);

    if (!metric) {
      this.warn(`Операция с correlationId ${correlationId} не найдена`, meta);
      return null;
    }

    const logMeta: LogMetadata = {
      correlationId,
      operationType: metric.operationType,
      duration: metric.duration,
      success,
      errorCount,
      ...meta,
    };

    if (success) {
      this.info(`Операция завершена успешно: ${metric.operationType}`, logMeta);
    } else {
      this.warn(`Операция завершена с ошибками: ${metric.operationType}`, logMeta);
    }

    // Проверяем алерты
    Logger.alertManager.checkAlerts(metric.operationType, metric, Logger.errorCounter);

    return metric;
  }

  /**
   * Логирование операции с Google Sheets
   */
  logSheetsOperation(
    operation: string,
    spreadsheetId: string,
    sheetName?: string,
    meta?: LogMetadata
  ): void {
    this.info(`Google Sheets операция: ${operation}`, {
      operationType: 'google_sheets_operation',
      spreadsheetId,
      sheetName,
      ...meta,
    });
  }

  /**
   * Логирование результатов синхронизации
   */
  logSyncResults(
    spreadsheetId: string,
    sheetName: string,
    rowsWritten: number,
    success: boolean,
    duration: number,
    meta?: LogMetadata
  ): void {
    const logMeta: LogMetadata = {
      operationType: 'google_sheets_sync',
      spreadsheetId,
      sheetName,
      rowsCount: rowsWritten,
      duration,
      success,
      ...meta,
    };

    if (success) {
      this.info(`Синхронизация успешна: ${sheetName}`, logMeta);
    } else {
      this.error(`Синхронизация не удалась: ${sheetName}`, logMeta);
    }
  }

  /**
   * Получение статистики ошибок
   */
  getErrorStats(operationType?: string): {
    totalErrors: number;
    recentErrors: number;
    lastError?: Date;
    operationType?: string;
    activeOperations?: number;
  } {
    if (operationType) {
      return {
        totalErrors: Logger.errorCounter.getErrorCount(operationType),
        recentErrors: Logger.errorCounter.getErrorCount(operationType, 5 * 60 * 1000), // 5 минут
        lastError: Logger.errorCounter.getLastError(operationType) || undefined,
        operationType,
      };
    }

    // Общая статистика по всем операциям
    const activeOperations = Logger.metricsManager.getActiveOperations();
    let totalErrors = 0;
    let recentErrors = 0;

    // Получаем все типы операций из счётчиков
    Object.keys((Logger.errorCounter as any).counters).forEach(type => {
      totalErrors += Logger.errorCounter.getErrorCount(type);
      recentErrors += Logger.errorCounter.getErrorCount(type, 5 * 60 * 1000);
    });

    return {
      totalErrors,
      recentErrors,
      activeOperations: activeOperations.size,
    };
  }

  /**
   * Получение метрик операций
   */
  getOperationMetrics(): {
    activeOperations: number;
    totalOperations: number;
    averageDuration?: number;
  } {
    const activeOperations = Logger.metricsManager.getActiveOperations();

    return {
      activeOperations: activeOperations.size,
      totalOperations: 0, // Можно добавить хранение завершённых операций
    };
  }

  /**
   * Очистка ресурсов
   */
  static cleanup(): void {
    Logger.errorCounter.destroy();
  }
}

/**
 * Фабричная функция для создания логгера
 */
export function createLogger(category: LogCategory, component?: string): Logger {
  return new Logger(category, component);
}

/**
 * Получение логгера для API
 */
export function getApiLogger(component?: string): Logger {
  return new Logger(LogCategory.API, component);
}

/**
 * Получение логгера для базы данных
 */
export function getDatabaseLogger(component?: string): Logger {
  return new Logger(LogCategory.DATABASE, component);
}

/**
 * Получение логгера для сервисов
 */
export function getServiceLogger(component?: string): Logger {
  return new Logger(LogCategory.SERVICE, component);
}

/**
 * Получение логгера для планировщика
 */
export function getSchedulerLogger(component?: string): Logger {
  return new Logger(LogCategory.SCHEDULER, component);
}

/**
 * Получение логгера для Google Sheets операций
 */
export function getGoogleSheetsLogger(component?: string): Logger {
  return new Logger(LogCategory.GOOGLE_SHEETS, component);
}

/**
 * Получение логгера для метрик
 */
export function getMetricsLogger(component?: string): Logger {
  return new Logger(LogCategory.METRICS, component);
}

/**
 * Получение логгера для алертов
 */
export function getAlertsLogger(component?: string): Logger {
  return new Logger(LogCategory.ALERTS, component);
}

/**
 * Общий логгер для приложения
 */
export const logger = new Logger(LogCategory.GENERAL);

// Экспорт по умолчанию
export default logger;