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
}

// Интерфейс для структурированных логов
export interface LogMetadata {
  category?: LogCategory;
  component?: string;
  method?: string;
  duration?: number;
  error?: Error | string;
  [key: string]: any;
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

  constructor(category: LogCategory = LogCategory.GENERAL, component?: string) {
    this.category = category;
    this.component = component;
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
    this.error(context ? `${context}: ${error.message}` : error.message, {
      error: error.stack || error.message,
      ...meta,
    });
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
 * Общий логгер для приложения
 */
export const logger = new Logger(LogCategory.GENERAL);

// Экспорт по умолчанию
export default logger;