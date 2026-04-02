export const MARKETPLACE_NAMES = [
  "Mercado Livre",
  "Shopee",
  "Amazon",
  "Magalu",
  "Americanas",
  "Shopify",
] as const;

export type MarketplaceName = typeof MARKETPLACE_NAMES[number];

// Marketplaces with active backend integration
export const INTEGRATED_MARKETPLACES: MarketplaceName[] = ["Mercado Livre"];

// All marketplaces for filter dropdowns (includes "all" option)
export const MARKETPLACE_FILTER_OPTIONS = [
  "Todos os marketplaces",
  ...MARKETPLACE_NAMES,
] as const;
