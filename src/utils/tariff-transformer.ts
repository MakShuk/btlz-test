import { WarehouseWithTariffsData, BoxTariff } from '../types/wildberries.js';
import { CreateTariffRequest } from '../services/tariff-service.js';

/**
 * Утилитарный класс для преобразования данных тарифов из формата API Wildberries
 * в формат для сохранения в базу данных
 */
export class TariffTransformer {
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
    };
  }
}

// Экспорт по умолчанию для удобства
export default TariffTransformer;