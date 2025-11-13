import { z } from 'zod';

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

// Схема для валидации данных о складах с тарифами
export const warehouseWithTariffsSchema = z.object({
  warehouseName: z.string(),
  geoName: z.string().optional(),
  // Тарифы доставки FBO
  boxDeliveryBase: numericValueSchema.nullable(),
  boxDeliveryLiter: numericValueSchema.nullable(),
  boxDeliveryCoefExpr: numericValueSchema.nullable(),
  // Тарифы доставки FBS
  boxDeliveryMarketplaceBase: numericValueSchema.nullable(),
  boxDeliveryMarketplaceLiter: numericValueSchema.nullable(),
  boxDeliveryMarketplaceCoefExpr: numericValueSchema.nullable(),
  // Тарифы хранения
  boxStorageBase: numericValueSchema.nullable(),
  boxStorageLiter: numericValueSchema.nullable(),
  boxStorageCoefExpr: numericValueSchema.nullable(),
});

// Схема для валидации данных о складах (без тарифов)
export const warehouseSchema = z.object({
  warehouseName: z.string(),
  geoName: z.string().optional(),
});

// Схема для валидации тарифов
export const boxTariffSchema = z.object({
  warehouseId: z.string(),
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
  dt_till_max: z.string().nullable(),
});

// Схема для валидации ответа с тарифами
export const boxTariffResponseSchema = z.object({
  response: z.object({
    data: z.object({
      dtNextBox: z.string().nullable().optional(),
      dtTillMax: z.string().nullable().optional(),
      warehouseList: z.array(warehouseWithTariffsSchema),
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
export type WarehouseWithTariffsData = z.infer<typeof warehouseWithTariffsSchema>;
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

// Типы для таблицы spreadsheets
export interface Spreadsheet {
  spreadsheet_id: string;
  sheet_name: string;
  description: string | null;
  is_active: boolean;
  last_synced_at: Date | null;
  credentials_ref: string | null;
  created_at: Date;
  updated_at: Date;
}

// Интерфейс для создания spreadsheet
export interface CreateSpreadsheetRequest {
  spreadsheet_id: string;
  sheet_name: string;
  description?: string | null;
  is_active?: boolean;
  last_synced_at?: Date | null;
  credentials_ref?: string | null;
}

// Интерфейс для обновления spreadsheet
export interface UpdateSpreadsheetRequest {
  sheet_name?: string;
  description?: string | null;
  is_active?: boolean;
  last_synced_at?: Date | null;
  credentials_ref?: string | null;
}

// Типы для работы с Google Sheets API
export interface GoogleSheetsConfig {
  credentials_json: string;
  sheet_ids: string[];
  default_sheet_name: string;
  app_scopes: string[];
}

// Типы для синхронизации с Google Sheets
export interface SpreadsheetSyncResult {
  spreadsheet_id: string;
  sheet_name: string;
  success: boolean;
  rows_written?: number;
  error?: string;
  synced_at: Date;
}