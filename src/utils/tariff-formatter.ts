import { Tariff } from '../services/tariff-service.js';
import { Warehouse } from '../services/warehouse-service.js';
import { TariffTransformer } from './tariff-transformer.js';

/**
 * Утилитарный класс для форматирования данных тарифов перед отправкой в Google Sheets
 */
export class TariffFormatter {
  /**
   * Возвращает массив заголовков для Google Sheets
   * @returns string[] - массив заголовков
   */
  static getHeaders(): string[] {
    return [
      "warehouseName",
      "updated_at",
      "boxDeliveryBase",
      "boxDeliveryCoefExpr",
      "boxDeliveryLiter",
      "boxDeliveryMarketplaceBase",
      "boxDeliveryMarketplaceCoefExpr",
      "boxDeliveryMarketplaceLiter",
      "boxStorageBase",
      "boxStorageCoefExpr",
      "boxStorageLiter",
      "geoName"
    ];
  }

  /**
   * Форматирует данные тарифов для Google Sheets
   * @param tariffs - массив тарифов
   * @param warehouses - массив складов
   * @returns any[][] - двумерный массив, где первая строка - заголовки, остальные - данные
   */
  static formatTariffsForSheet(tariffs: Tariff[], warehouses: Warehouse[]): any[][] {
    // Создаем карту складов для быстрого доступа по ID
    const warehouseMap = new Map<number, { name: string; geoName: string | null }>();
    warehouses.forEach(warehouse => {
      warehouseMap.set(warehouse.id, {
        name: warehouse.warehouse_name,
        geoName: warehouse.geo_name
      });
    });

    // Преобразуем каждый тариф в формат для Google Sheets
    const formattedTariffs = tariffs.map(tariff => {
      const warehouse = warehouseMap.get(tariff.warehouse_id) || {
        name: 'Неизвестный склад',
        geoName: null
      };
      return TariffTransformer.toSheetsFormat(tariff, warehouse.name, warehouse.geoName);
    });

    // Сортируем по коэффициенту сортировки (null значения в конце)
    formattedTariffs.sort((a, b) => {
      // Поскольку sorting_coefficient больше нет в возвращаемом формате,
      // используем boxStorageBase для сортировки как альтернативу
      if (a.boxStorageBase === null && b.boxStorageBase === null) return 0;
      if (a.boxStorageBase === null) return 1;
      if (b.boxStorageBase === null) return -1;
      return a.boxStorageBase - b.boxStorageBase;
    });

    // Преобразуем каждый отформатированный тариф в массив значений для строки таблицы
    const rows = formattedTariffs.map(formattedTariff =>
      TariffFormatter.toTableRow(formattedTariff)
    );

    // Добавляем заголовки в начало
    return [this.getHeaders(), ...rows];
  }

  /**
   * Преобразует отформатированный тариф в массив значений для строки таблицы
   * @param formattedTariff - объект из toSheetsFormat
   * @returns any[] - массив значений в порядке заголовков
   */
  private static toTableRow(formattedTariff: {
    boxDeliveryBase: number | null;
    boxDeliveryCoefExpr: number | null;
    boxDeliveryLiter: number | null;
    boxDeliveryMarketplaceBase: number | null;
    boxDeliveryMarketplaceCoefExpr: number | null;
    boxDeliveryMarketplaceLiter: number | null;
    boxStorageBase: number | null;
    boxStorageCoefExpr: number | null;
    boxStorageLiter: number | null;
    geoName: string | null;
    warehouseName: string;
    updated_at: string | null;
  }): any[] {
    // Функция для форматирования чисел с 2 знаками после запятой
    const formatNumber = (num: number | null): string | number => {
      if (num === null) return '';
      return Math.round(num * 100) / 100;
    };

    return [
      formattedTariff.warehouseName,
      formattedTariff.updated_at || '',
      formatNumber(formattedTariff.boxDeliveryBase),
      formatNumber(formattedTariff.boxDeliveryCoefExpr),
      formatNumber(formattedTariff.boxDeliveryLiter),
      formatNumber(formattedTariff.boxDeliveryMarketplaceBase),
      formatNumber(formattedTariff.boxDeliveryMarketplaceCoefExpr),
      formatNumber(formattedTariff.boxDeliveryMarketplaceLiter),
      formatNumber(formattedTariff.boxStorageBase),
      formatNumber(formattedTariff.boxStorageCoefExpr),
      formatNumber(formattedTariff.boxStorageLiter),
      formattedTariff.geoName || ''
    ];
  }

  /**
   * Подготавливает данные для листа stocks_coefs
   * @param tariffs - массив тарифов
   * @param warehouses - массив складов
   * @returns объект с полями для листа stocks_coefs
   */
  static prepareStocksCoefs(tariffs: Tariff[], warehouses: Warehouse[]): {
    sheetName: string;
    headers: string[];
    data: any[][];
    totalRows: number;
  } {
    const formattedData = this.formatTariffsForSheet(tariffs, warehouses);

    // Первая строка - заголовки, остальные - данные
    const headers = formattedData[0];
    const data = formattedData.slice(1);

    return {
      sheetName: "stocks_coefs",
      headers,
      data,
      totalRows: data.length
    };
  }
}

// Экспорт по умолчанию для удобства
export default TariffFormatter;