import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as bottleneck from 'bottleneck';
import { z } from 'zod';
import dotenv from 'dotenv';
import {
  boxTariffResponseSchema,
  apiErrorSchema,
  GetTariffsRequest,
  BoxTariffResponse,
  ApiError,
} from '../types/wildberries.js';
import { getApiLogger } from '../utils/logger.js';

// Правильный тип для bottleneck
type Bottleneck = bottleneck.default;

// Загрузка переменных окружения
dotenv.config();

// Классы ошибок для специфичных ситуаций
export class WildberriesApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public errorData?: ApiError
  ) {
    super(message);
    this.name = 'WildberriesApiError';
  }
}

export class WildberriesDateValidationError extends WildberriesApiError {
  constructor(message: string) {
    super(message, 400);
    this.name = 'WildberriesDateValidationError';
  }
}

export class WildberriesAuthError extends WildberriesApiError {
  constructor(message: string) {
    super(message, 401);
    this.name = 'WildberriesAuthError';
  }
}

export class WildberriesRateLimitError extends WildberriesApiError {
  constructor(message: string) {
    super(message, 429);
    this.name = 'WildberriesRateLimitError';
  }
}

// Основной класс клиента API
export class WildberriesApiClient {
  private limiter: Bottleneck;
  private axiosInstance: AxiosInstance;
  private readonly MAX_RETRIES = 3;
  private readonly BASE_URL: string;
  private logger = getApiLogger('WildberriesApiClient');

  constructor(apiKey?: string) {
    // Получаем API ключ из параметров или переменных окружения
    const key = apiKey || process.env.WB_API_TOKEN;

    if (!key) {
      throw new Error('API ключ Wildberries не указан. Установите переменную окружения WB_API_TOKEN или передайте ключ в конструктор.');
    }

    // Получаем базовый URL из переменных окружения
    this.BASE_URL = process.env.WB_API_BASE_URL || 'https://common-api.wildberries.ru';

    // Настраиваем rate limiter: 60 запросов в минуту, 5 запросов в секунду (burst)
    this.limiter = new bottleneck.default({
      minTime: 200, // 200ms между запросами (5 в секунду)
      maxConcurrent: 5,
      reservoir: 60, // 60 запросов
      reservoirRefreshAmount: 60,
      reservoirRefreshInterval: 60 * 1000, // 1 минута
    });

    // Настраиваем axios
    this.axiosInstance = axios.create({
      baseURL: this.BASE_URL,
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000, // 30 секунд таймаут
    });

    // Добавляем interceptor для обработки ошибок
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => this.handleApiError(error)
    );
  }

  /**
   * Получение тарифов за указанную дату
   * @param date - Дата в формате YYYY-MM-DD
   * @returns Данные о тарифах
   */
  public async getTariffs(date: string): Promise<BoxTariffResponse> {
    const endOperation = this.logger.startOperation('getTariffs', { date });

    // Валидация формата даты
    if (!this.isValidDate(date)) {
      this.logger.error('Невалидный формат даты', { date, expected: 'YYYY-MM-DD' });
      throw new WildberriesDateValidationError(`Невалидный формат даты: ${date}. Ожидается формат YYYY-MM-DD`);
    }

    const url = `/api/v1/tariffs/box?date=${date}`;
    this.logger.logRequest('GET', url, { date });

    try {
      const startTime = Date.now();
      const response = await this.withRetry(() =>
        this.limiter.schedule(() => this.axiosInstance.get(url))
      ) as AxiosResponse;

      const duration = Date.now() - startTime;
      this.logger.logResponse('GET', url, response.status, duration, {
        date,
        dataSize: JSON.stringify(response.data).length
      });

      // Валидация ответа через Zod схему с более гибким подходом
      const validatedData = this.validateTariffResponse(response.data);

      this.logger.info('Тарифы успешно получены', {
        date,
        warehousesCount: validatedData.response.data.warehouseList.length
      });

      endOperation();
      return validatedData;
    } catch (error) {
      endOperation();
      this.logger.logError(error as Error, 'Ошибка при получении тарифов', { date, url });

      if (error instanceof WildberriesApiError) {
        throw error;
      }
      throw new WildberriesApiError(`Не удалось получить тарифы: ${(error as Error).message}`);
    }
  }

  /**
   * Обработка специфичных ошибок API
   */
  private handleApiError(error: any): never {
    if (error.response) {
      const { status, data } = error.response;

      // Валидация ошибки через Zod схему
      let errorData: ApiError;
      try {
        errorData = this.validateResponse(data, apiErrorSchema);
      } catch {
        errorData = {
          error: true,
          errorText: data?.message || 'Неизвестная ошибка API',
          additionalErrors: [],
          statusCode: status,
        };
      }

      this.logger.error('Ошибка API', {
        statusCode: status,
        errorText: errorData.errorText,
        additionalErrors: errorData.additionalErrors
      });

      switch (status) {
        case 400:
          throw new WildberriesDateValidationError(errorData.errorText);
        case 401:
          this.logger.error('Ошибка авторизации - проверьте API токен', { statusCode: 401 });
          throw new WildberriesAuthError(errorData.errorText);
        case 429:
          this.logger.warn('Превышен лимит запросов - применяется retry', { statusCode: 429 });
          throw new WildberriesRateLimitError(errorData.errorText);
        default:
          throw new WildberriesApiError(
            errorData.errorText,
            status,
            errorData
          );
      }
    } else if (error.request) {
      this.logger.error('Сервер не отвечает', { error: error.message });
      throw new WildberriesApiError('Сервер не отвечает. Проверьте подключение к интернету.');
    } else {
      this.logger.error('Ошибка запроса', { error: error.message });
      throw new WildberriesApiError(`Ошибка запроса: ${error.message}`);
    }
  }

  /**
   * Реализация retry логики с exponential backoff
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    attempt: number = 1
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      // Не повторяем попытки для ошибок авторизации и валидации
      if (
        error instanceof WildberriesAuthError ||
        error instanceof WildberriesDateValidationError ||
        attempt >= this.MAX_RETRIES
      ) {
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt - 1) * 1000;
      this.logger.warn(`Повторная попытка ${attempt}/${this.MAX_RETRIES}`, {
        attempt,
        delay,
        error: (error as Error).message
      });

      await new Promise(resolve => setTimeout(resolve, delay));

      return this.withRetry(operation, attempt + 1);
    }
  }

  /**
   * Валидация ответов через Zod схемы
   */
  private validateResponse<T>(data: unknown, schema: z.ZodSchema<T>): T {
    try {
      return schema.parse(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
        this.logger.error('Ошибка валидации ответа API', {
          errors: errorMessages,
          receivedData: JSON.stringify(data).substring(0, 500)
        });
        throw new WildberriesApiError(
          `Ошибка валидации ответа API: ${errorMessages.join(', ')}`
        );
      }
      this.logger.error('Ошибка валидации ответа API', { error: (error as Error).message });
      throw new WildberriesApiError(`Ошибка валидации ответа API: ${(error as Error).message}`);
    }
  }

  /**
   * Валидация ответа с тарифами с учетом возможных несоответствий типов
   */
  private validateTariffResponse(data: unknown): BoxTariffResponse {
    try {
      // Логируем сырые данные только если включен специальный флаг для отладки
      if (process.env.LOG_RAW_API_RESPONSE === 'true') {
        this.logger.debug('Сырой ответ от API', { rawData: JSON.stringify(data, null, 2) });
      }

      // Валидируем по основной схеме
      const validatedData = boxTariffResponseSchema.parse(data);

      this.logger.info('Тарифы успешно получены', {
        warehousesCount: validatedData.response.data.warehouseList.length
      });

      return validatedData;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
        this.logger.error('Ошибка валидации тарифного ответа', { errors: errorMessages });
        throw new WildberriesApiError(
          `Ошибка валидации ответа API: ${errorMessages.join(', ')}`
        );
      }
      this.logger.error('Ошибка валидации тарифного ответа', { error: (error as Error).message });
      throw new WildberriesApiError(`Ошибка валидации ответа API: ${(error as Error).message}`);
    }
  }

  /**
   * Проверка валидности даты в формате YYYY-MM-DD
   */
  private isValidDate(dateString: string): boolean {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) return false;

    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
  }
}

// Функция для создания экземпляра клиента
export function createWildberriesApiClient(apiKey?: string): WildberriesApiClient {
  return new WildberriesApiClient(apiKey);
}

// Экспорт по умолчанию для удобства
export default WildberriesApiClient;