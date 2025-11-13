import { WarehouseWithTariffsData, BoxTariff } from '../types/wildberries.js';
import { CreateTariffRequest } from '../services/tariff-service.js';

/**
 * Утилитарный класс для преобразования данных тарифов из формата API Wildberries
 * в формат для сохранения в базу данных
 */
export class TariffTransformer {
  /**
   * Расчёт коэффициента сортировки на основе базовых ставок доставки и хранения
   * @param tariffData - данные тарифа с полями для расчёта
   * @returns number | null - рассчитанный коэффициент сортировки или null если все поля null
   */
  static calculateSortingCoefficient(tariffData: {
    box_delivery_base?: number | null;
    box_delivery_marketplace_base?: number | null;
    box_storage_base?: number | null;
  }): number | null {
    // Получаем значения, заменяя null на 0
    const deliveryBase = tariffData.box_delivery_base ?? 0;
    const deliveryMarketplaceBase = tariffData.box_delivery_marketplace_base ?? 0;
    const storageBase = tariffData.box_storage_base ?? 0;

    // Если все значения были null, возвращаем null
    if (deliveryBase === 0 && deliveryMarketplaceBase === 0 && storageBase === 0) {
      return null;
    }

    // Расчёт по формуле: (box_delivery_base * 0.6 + box_delivery_marketplace_base * 0.4 + box_storage_base * 0.3) / 100
    const coefficient = (deliveryBase * 0.6 + deliveryMarketplaceBase * 0.4 + storageBase * 0.3) / 100;

    // Округляем до 2 знаков после запятой
    return Math.round(coefficient * 100) / 100;
  }

  /**
   * Преобразование данных из API Wildberries в формат для базы данных
   * @param warehouseData - данные склада с тарифами из API
   * @param warehouseId - ID склада в базе данных
   * @param tariffDate - дата тарифа
   * @param dtNextBox - дата следующего бокса из API
   * @param dtTillMax - максимальная дата действия тарифа из API
   * @returns CreateTariffRequest - данные для создания/обновления тарифа
   */
  static fromWarehouseData(
    warehouseData: WarehouseWithTariffsData,
    warehouseId: number,
    tariffDate: Date | string,
    dtNextBox?: string | null,
    dtTillMax?: string | null
  ): CreateTariffRequest {
    // Расчёт коэффициента сортировки
    const sortingCoefficient = this.calculateSortingCoefficient({
      box_delivery_base: warehouseData.boxDeliveryBase,
      box_delivery_marketplace_base: warehouseData.boxDeliveryMarketplaceBase,
      box_storage_base: warehouseData.boxStorageBase,
    });

    return {
      warehouse_id: warehouseId,
      tariff_date: tariffDate,
      box_delivery_base: warehouseData.boxDeliveryBase,
      box_delivery_liter: warehouseData.boxDeliveryLiter,
      box_delivery_coef_expr: warehouseData.boxDeliveryCoefExpr,
      box_delivery_marketplace_base: warehouseData.boxDeliveryMarketplaceBase,
      box_delivery_marketplace_liter: warehouseData.boxDeliveryMarketplaceLiter,
      box_delivery_marketplace_coef_expr: warehouseData.boxDeliveryMarketplaceCoefExpr,
      box_storage_base: warehouseData.boxStorageBase,
      box_storage_liter: warehouseData.boxStorageLiter,
      box_storage_coef_expr: warehouseData.boxStorageCoefExpr,
      dt_next_box: dtNextBox ?? null,
      dt_till_max: dtTillMax ?? null,
      sorting_coefficient: sortingCoefficient,
    };
  }

  /**
   * Преобразование данных из BoxTariff в формат для базы данных
   * @param boxTariff - данные тарифа из API
   * @param warehouseId - ID склада в базе данных
   * @param tariffDate - дата тарифа
   * @returns CreateTariffRequest - данные для создания/обновления тарифа
   */
  static fromBoxTariff(
    boxTariff: BoxTariff,
    warehouseId: number,
    tariffDate: Date | string
  ): CreateTariffRequest {
    // Расчёт коэффициента сортировки
    const sortingCoefficient = this.calculateSortingCoefficient({
      box_delivery_base: boxTariff.box_delivery_base,
      box_delivery_marketplace_base: boxTariff.box_delivery_marketplace_base,
      box_storage_base: boxTariff.box_storage_base,
    });

    return {
      warehouse_id: warehouseId,
      tariff_date: tariffDate,
      box_delivery_base: boxTariff.box_delivery_base,
      box_delivery_liter: boxTariff.box_delivery_liter,
      box_delivery_coef_expr: boxTariff.box_delivery_coef_expr,
      box_delivery_marketplace_base: boxTariff.box_delivery_marketplace_base,
      box_delivery_marketplace_liter: boxTariff.box_delivery_marketplace_liter,
      box_delivery_marketplace_coef_expr: boxTariff.box_delivery_marketplace_coef_expr,
      box_storage_base: boxTariff.box_storage_base,
      box_storage_liter: boxTariff.box_storage_liter,
      box_storage_coef_expr: boxTariff.box_storage_coef_expr,
      dt_next_box: boxTariff.dt_next_box,
      dt_till_max: boxTariff.dt_till_max,
      sorting_coefficient: sortingCoefficient,
    };
  }

  /**
   * Преобразование данных тарифа в формат для Google Sheets
   * @param tariff - данные тарифа из базы данных
   * @param warehouseName - название склада
   * @returns объект с полями для Google Sheets
   */
  static toSheetsFormat(tariff: {
    tariff_date: Date | string;
    box_delivery_base: number | null;
    box_delivery_marketplace_base: number | null;
    box_storage_base: number | null;
    sorting_coefficient: number | null;
    dt_next_box: string | null;
    dt_till_max: Date | string | null;
  }, warehouseName: string): {
    warehouse_name: string;
    tariff_date: string;
    delivery_fbo: number | null;
    delivery_fbs: number | null;
    storage: number | null;
    sorting_coefficient: number | null;
    dt_next_box: string | null;
    dt_till_max: string | null;
  } {
    // Форматирование даты в строку YYYY-MM-DD
    const formatDate = (date: Date | string | null): string | null => {
      if (!date) return null;
      if (typeof date === 'string') {
        // Если строка уже в формате YYYY-MM-DD, возвращаем как есть
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
        // Иначе преобразуем в Date и форматируем
        return new Date(date).toISOString().split('T')[0];
      }
      return date.toISOString().split('T')[0];
    };

    return {
      warehouse_name: warehouseName,
      tariff_date: formatDate(tariff.tariff_date) || '',
      delivery_fbo: tariff.box_delivery_base,
      delivery_fbs: tariff.box_delivery_marketplace_base,
      storage: tariff.box_storage_base,
      sorting_coefficient: tariff.sorting_coefficient,
      dt_next_box: tariff.dt_next_box,
      dt_till_max: formatDate(tariff.dt_till_max),
    };
  }
}

// Экспорт по умолчанию для удобства
export default TariffTransformer;