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
      "Склад",
      "Дата тарифа",
      "Доставка FBO (₽)",
      "Доставка FBS (₽)",
      "Хранение (₽)",
      "Коэффициент",
      "След. бокс",
      "Макс. дата"
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
    const warehouseMap = new Map<number, string>();
    warehouses.forEach(warehouse => {
      warehouseMap.set(warehouse.id, warehouse.warehouse_name);
    });

    // Преобразуем каждый тариф в формат для Google Sheets
    const formattedTariffs = tariffs.map(tariff => {
      const warehouseName = warehouseMap.get(tariff.warehouse_id) || 'Неизвестный склад';
      return TariffTransformer.toSheetsFormat(tariff, warehouseName);
    });

    // Сортируем по коэффициенту сортировки (null значения в конце)
    formattedTariffs.sort((a, b) => {
      if (a.sorting_coefficient === null && b.sorting_coefficient === null) return 0;
      if (a.sorting_coefficient === null) return 1;
      if (b.sorting_coefficient === null) return -1;
      return a.sorting_coefficient - b.sorting_coefficient;
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
    warehouse_name: string;
    tariff_date: string;
    delivery_fbo: number | null;
    delivery_fbs: number | null;
    storage: number | null;
    sorting_coefficient: number | null;
    dt_next_box: string | null;
    dt_till_max: string | null;
  }): any[] {
    // Функция для форматирования чисел с 2 знаками после запятой
    const formatNumber = (num: number | null): string | number => {
      if (num === null) return '';
      return Math.round(num * 100) / 100;
    };

    return [
      formattedTariff.warehouse_name,
      formattedTariff.tariff_date,
      formatNumber(formattedTariff.delivery_fbo),
      formatNumber(formattedTariff.delivery_fbs),
      formatNumber(formattedTariff.storage),
      formatNumber(formattedTariff.sorting_coefficient),
      formattedTariff.dt_next_box || '',
      formattedTariff.dt_till_max || ''
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