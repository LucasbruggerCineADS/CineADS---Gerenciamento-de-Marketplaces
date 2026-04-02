/**
 * Magalu Integration Adapter
 * Implementa MarketplaceAdapter para a API do Magazine Luiza.
 */
import { logger } from "@/lib/logger";
import type {
  MarketplaceAdapter,
  SyncResult,
  StockUpdateItem,
  PriceUpdateItem,
} from "../types/integration-events";

const MARKETPLACE = "Magalu";

function stub(operation: string, start: number): SyncResult {
  return {
    success: false,
    operation: operation as SyncResult["operation"],
    marketplace: MARKETPLACE,
    synced: 0,
    errors: 1,
    details: { error: "Integração Magalu ainda não implementada. Em breve disponível." },
    durationMs: Date.now() - start,
  };
}

export const magaluAdapter: MarketplaceAdapter = {
  marketplace: MARKETPLACE,

  async fetchOrders(tenantId: string): Promise<SyncResult> {
    const start = Date.now();
    logger.info("magalu.fetchOrders", { tenantId });
    return stub("sync_orders", start);
  },

  async fetchProducts(tenantId: string): Promise<SyncResult> {
    const start = Date.now();
    logger.info("magalu.fetchProducts", { tenantId });
    return stub("sync_products", start);
  },

  async fetchStock(tenantId: string): Promise<SyncResult> {
    const start = Date.now();
    logger.info("magalu.fetchStock", { tenantId });
    return stub("sync_stock", start);
  },

  async updateStock(tenantId: string, items: StockUpdateItem[]): Promise<SyncResult> {
    const start = Date.now();
    logger.info("magalu.updateStock", { tenantId, count: items.length });
    return stub("sync_stock", start);
  },

  async updatePrice(tenantId: string, items: PriceUpdateItem[]): Promise<SyncResult> {
    const start = Date.now();
    logger.info("magalu.updatePrice", { tenantId, count: items.length });
    return stub("sync_prices", start);
  },

  async refreshAccessToken(tenantId: string): Promise<boolean> {
    logger.info("magalu.refreshAccessToken", { tenantId });
    return false;
  },
};
