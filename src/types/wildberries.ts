import { z } from 'zod';

// Схема для валидации данных о складах
export const warehouseSchema = z.object({
  id: z.number(),
  warehouseName: z.string(),
  geoName: z.string().optional(),
});

// Схема для валидации числовых значений, которые могут приходить как "-" (NULL)
const numericValueSchema = z.union([
  z.string().transform((val) => {
    // Преобразуем "-" в null
    if (val === '-' || val === '' || val === null) {
      return null;
    }
    // Заменяем запятую на точку и преобразуем в число
    const normalized = val.replace(',', '.');
    const parsed = parseFloat(normalized);
    return isNaN(parsed) ? null : parsed;
  }),
  z.number(),
  z.null(),
]);

// Схема для валидации тарифов
export const boxTariffSchema = z.object({
  warehouseId: z.number(),
  // Тарифы доставки FBO
  box_delivery_base: numericValueSchema.nullable(),
  box_delivery_liter: numericValueSchema.nullable(),
  box_delivery_coef_expr: numericValueSchema.nullable(),
  // Тарифы доставки FBS
  box_delivery_marketplace_base: numericValueSchema.nullable(),
  box_delivery_marketplace_liter: numericValueSchema.nullable(),
  box_delivery_marketplace_coef_expr: numericValueSchema.nullable(),
  // Тарифы хранения
  box_storage_base: numericValueSchema.nullable(),
  box_storage_liter: numericValueSchema.nullable(),
  box_storage_coef_expr: numericValueSchema.nullable(),
  // Метаданные
  dt_next_box: z.string().nullable(),
  dt_till_max: z.string().nullable().transform((val) => {
    if (!val) return null;
    const date = new Date(val);
    return isNaN(date.getTime()) ? null : date;
  }),
});

// Схема для валидации ответа с тарифами
export const boxTariffResponseSchema = z.object({
  response: z.object({
    data: z.object({
      warehouseList: z.array(warehouseSchema),
      boxTariffs: z.array(boxTariffSchema),
    }),
    error: z.boolean().optional(),
    errorText: z.string().optional(),
    additionalErrors: z.array(z.string()).optional(),
  }),
});

// Схема для валидации ошибок API
export const apiErrorSchema = z.object({
  error: z.boolean(),
  errorText: z.string(),
  additionalErrors: z.array(z.string()).optional(),
  statusCode: z.number().optional(),
});

// Экспорт TypeScript типов через z.infer
export type WarehouseData = z.infer<typeof warehouseSchema>;
export type BoxTariff = z.infer<typeof boxTariffSchema>;
export type BoxTariffResponse = z.infer<typeof boxTariffResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;

// Вспомогательные типы для работы с данными
export type TariffData = Omit<BoxTariff, 'warehouseId'> & {
  warehouseId: number;
  tariffDate: Date;
};

// Типы для API запросов
export interface GetTariffsRequest {
  date: string; // Формат: YYYY-MM-DD
}

// Типы для API ответов
export interface ApiResponse<T> {
  data?: T;
  error?: boolean;
  errorText?: string;
  additionalErrors?: string[];
}