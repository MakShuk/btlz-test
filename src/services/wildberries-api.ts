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
  private readonly BASE_URL = 'https://suppliers-api.wildberries.ru';

  constructor(apiKey?: string) {
    // Получаем API ключ из параметров или переменных окружения
    const key = apiKey || process.env.WB_API_TOKEN;

    if (!key) {
      throw new Error('API ключ Wildberries не указан. Установите переменную окружения WB_API_TOKEN или передайте ключ в конструктор.');
    }

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
    // Валидация формата даты
    if (!this.isValidDate(date)) {
      throw new WildberriesDateValidationError(`Невалидный формат даты: ${date}. Ожидается формат YYYY-MM-DD`);
    }

    const url = `/api/v1/tariffs/box?date=${date}`;

    try {
      const response = await this.withRetry(() =>
        this.limiter.schedule(() => this.axiosInstance.get(url))
      ) as AxiosResponse;

      // Валидация ответа через Zod схему с более гибким подходом
      return this.validateTariffResponse(response.data);
    } catch (error) {
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

      switch (status) {
        case 400:
          throw new WildberriesDateValidationError(errorData.errorText);
        case 401:
          throw new WildberriesAuthError(errorData.errorText);
        case 429:
          throw new WildberriesRateLimitError(errorData.errorText);
        default:
          throw new WildberriesApiError(
            errorData.errorText,
            status,
            errorData
          );
      }
    } else if (error.request) {
      throw new WildberriesApiError('Сервер не отвечает. Проверьте подключение к интернету.');
    } else {
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
        throw new WildberriesApiError(
          `Ошибка валидации ответа API: ${errorMessages.join(', ')}`
        );
      }
      throw new WildberriesApiError(`Ошибка валидации ответа API: ${(error as Error).message}`);
    }
  }

  /**
   * Валидация ответа с тарифами с учетом возможных несоответствий типов
   */
  private validateTariffResponse(data: unknown): BoxTariffResponse {
    try {
      // Сначала валидируем базовую структуру
      const baseSchema = z.object({
        response: z.object({
          data: z.object({
            warehouseList: z.array(z.any()),
            boxTariffs: z.array(z.any()),
          }),
          error: z.boolean().optional(),
          errorText: z.string().optional(),
          additionalErrors: z.array(z.string()).optional(),
        }),
      });

      const validatedData = baseSchema.parse(data);

      // Затем преобразуем данные о тарифах, чтобы соответствовать схеме
      const transformedTariffs = validatedData.response.data.boxTariffs.map((tariff: any) => {
        // Преобразуем строковые значения в числа, если необходимо
        const transformNumericValue = (val: any): number | null => {
          if (val === null || val === undefined || val === '-' || val === '') {
            return null;
          }
          if (typeof val === 'number') {
            return val;
          }
          if (typeof val === 'string') {
            const normalized = val.replace(',', '.');
            const parsed = parseFloat(normalized);
            return isNaN(parsed) ? null : parsed;
          }
          return null;
        };

        return {
          warehouseId: tariff.warehouseId,
          box_delivery_base: transformNumericValue(tariff.box_delivery_base),
          box_delivery_liter: transformNumericValue(tariff.box_delivery_liter),
          box_delivery_coef_expr: transformNumericValue(tariff.box_delivery_coef_expr),
          box_delivery_marketplace_base: transformNumericValue(tariff.box_delivery_marketplace_base),
          box_delivery_marketplace_liter: transformNumericValue(tariff.box_delivery_marketplace_liter),
          box_delivery_marketplace_coef_expr: transformNumericValue(tariff.box_delivery_marketplace_coef_expr),
          box_storage_base: transformNumericValue(tariff.box_storage_base),
          box_storage_liter: transformNumericValue(tariff.box_storage_liter),
          box_storage_coef_expr: transformNumericValue(tariff.box_storage_coef_expr),
          dt_next_box: tariff.dt_next_box || null,
          dt_till_max: tariff.dt_till_max ? new Date(tariff.dt_till_max) : null,
        };
      });

      // Валидируем преобразованные данные по основной схеме
      return boxTariffResponseSchema.parse({
        response: {
          ...validatedData.response,
          data: {
            ...validatedData.response.data,
            boxTariffs: transformedTariffs,
          },
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
        throw new WildberriesApiError(
          `Ошибка валидации ответа API: ${errorMessages.join(', ')}`
        );
      }
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