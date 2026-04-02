/**
 * Shopee Integration Adapter
 * Implementa MarketplaceAdapter para a API da Shopee.
 */
import { logger } from "@/lib/logger";
import type {
  MarketplaceAdapter,
  SyncResult,
  StockUpdateItem,
  PriceUpdateItem,
} from "../types/integration-events";

const MARKETPLACE = "Shopee";

function stub(operation: string, start: number): SyncResult {
  return {
    success: false,
    operation: operation as SyncResult["operation"],
    marketplace: MARKETPLACE,
    synced: 0,
    errors: 1,
    details: { error: "Integração Shopee ainda não implementada. Em breve disponível." },
    durationMs: Date.now() - start,
  };
}

export const shopeeAdapter: MarketplaceAdapter = {
  marketplace: MARKETPLACE,

  async fetchOrders(tenantId: string): Promise<SyncResult> {
    const start = Date.now();
    logger.info("shopee.fetchOrders", { tenantId });
    // TODO: implementar integração real com Shopee Open Platform
    return stub("sync_orders", start);
  },

  async fetchProducts(tenantId: string): Promise<SyncResult> {
    const start = Date.now();
    logger.info("shopee.fetchProducts", { tenantId });
    return stub("sync_products", start);
  },

  async fetchStock(tenantId: string): Promise<SyncResult> {
    const start = Date.now();
    logger.info("shopee.fetchStock", { tenantId });
    return stub("sync_stock", start);
  },

  async updateStock(tenantId: string, items: StockUpdateItem[]): Promise<SyncResult> {
    const start = Date.now();
    logger.info("shopee.updateStock", { tenantId, count: items.length });
    return stub("sync_stock", start);
  },

  async updatePrice(tenantId: string, items: PriceUpdateItem[]): Promise<SyncResult> {
    const start = Date.now();
    logger.info("shopee.updatePrice", { tenantId, count: items.length });
    return stub("sync_prices", start);
  },

  async refreshAccessToken(tenantId: string): Promise<boolean> {
    logger.info("shopee.refreshAccessToken", { tenantId });
    return false;
  },
};
