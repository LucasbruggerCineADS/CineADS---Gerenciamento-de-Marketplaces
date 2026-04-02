import { useQuery } from "@tanstack/react-query";
import { ordersService } from "@/services/orders.service";
import { useAuth } from "@/lib/auth";
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { MARKETPLACE_FILTER_OPTIONS } from "@/constants/marketplaces";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Hash, User, ShoppingCart, Eye, X, CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion } from "framer-motion";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";

const statusConfig: Record<string, { label: string; className: string }> = {
  pending: { label: "Pendente", className: "bg-warning/15 text-warning border-warning/30" },
  paid: { label: "Pago", className: "bg-info/15 text-info border-info/30" },
  in_separation: { label: "Em Separação", className: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  processing: { label: "Faturado", className: "bg-primary/15 text-primary border-primary/30" },
  shipped: { label: "Enviado", className: "bg-accent/15 text-accent-foreground border-accent/30" },
  delivered: { label: "Entregue", className: "bg-success/15 text-success border-success/30" },
  cancelled: { label: "Cancelado", className: "bg-destructive/15 text-destructive border-destructive/30" },
};

const statusTabs = [
  { value: "all", label: "Todos" }, { value: "pending", label: "Pendentes" },
  { value: "paid", label: "Pagos" }, { value: "in_separation", label: "Em Separação" },
  { value: "processing", label: "Faturados" }, { value: "shipped", label: "Enviados" },
  { value: "delivered", label: "Entregues" }, { value: "cancelled", label: "Cancelados" },
];

const periodOptions = [
  { value: "all", label: "Todos os períodos" }, { value: "today", label: "Hoje" },
  { value: "7d", label: "Últimos 7 dias" }, { value: "30d", label: "Últimos 30 dias" },
  { value: "month", label: "Este mês" }, { value: "last_month", label: "Mês passado" },
  { value: "custom", label: "Personalizado" },
];

const marketplaceOptions = MARKETPLACE_FILTER_OPTIONS;

const PAGE_SIZE = 50;

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const t = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return debounced;
}

export default function OrdersPage() {
  const { profile } = useAuth();
  const [searchId, setSearchId] = useState("");
  const [searchName, setSearchName] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [marketplaceFilter, setMarketplaceFilter] = useState("Todos os marketplaces");
  const [periodFilter, setPeriodFilter] = useState("all");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [page, setPage] = useState(0);

  const debouncedId = useDebounce(searchId, 400);
  const debouncedName = useDebounce(searchName, 400);

  const getDateRange = (): { from: Date; to: Date } | null => {
    const now = new Date();
    switch (periodFilter) {
      case "today": return { from: startOfDay(now), to: endOfDay(now) };
      case "7d": return { from: subDays(now, 6), to: now };
      case "30d": return { from: subDays(now, 29), to: now };
      case "month": return { from: startOfMonth(now), to: now };
      case "last_month": return { from: startOfMonth(subMonths(now, 1)), to: endOfMonth(subMonths(now, 1)) };
      case "custom": return customRange?.from && customRange?.to ? { from: customRange.from, to: endOfDay(customRange.to) } : null;
      default: return null;
    }
  };

  const dateRange = getDateRange();
  const hasActiveFilters = marketplaceFilter !== "Todos os marketplaces" || periodFilter !== "all" || minValue || maxValue || debouncedId || debouncedName;

  const { data: queryResult, isLoading } = useQuery({
    queryKey: ["orders", profile?.tenant_id, statusFilter, debouncedId, debouncedName, marketplaceFilter, dateRange?.from?.toISOString(), dateRange?.to?.toISOString(), minValue, maxValue, page],
    queryFn: async () => {
      if (!profile?.tenant_id) return { data: [], count: 0 };
      return ordersService.listOrders({
        tenantId: profile.tenant_id,
        status: statusFilter !== "all" ? statusFilter : undefined,
        marketplace: marketplaceFilter !== "Todos os marketplaces" ? marketplaceFilter : undefined,
        dateFrom: dateRange?.from?.toISOString(),
        dateTo: dateRange?.to?.toISOString(),
        minValue: minValue ? Number(minValue) : undefined,
        maxValue: maxValue ? Number(maxValue) : undefined,
        searchId: debouncedId || undefined,
        searchName: debouncedName || undefined,
        page,
      });
    },
    enabled: !!profile?.tenant_id,
  });

  const orders = queryResult?.data || [];
  const totalCount = queryResult?.count || 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const clearFilters = () => {
    setSearchId(""); setSearchName("");
    setMarketplaceFilter("Todos os marketplaces"); setPeriodFilter("all");
    setCustomRange(undefined); setMinValue(""); setMaxValue(""); setPage(0);
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
        <h1 className="text-2xl font-bold tracking-tight">Pedidos</h1>
        <p className="text-sm text-muted-foreground">{totalCount} pedidos encontrados</p>
      </motion.div>

      <Tabs value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
        <TabsList className="h-auto flex-wrap gap-1 bg-transparent p-0">
          {statusTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-full px-4 py-1.5 text-sm">{tab.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Line 1: Search by ID + Customer Name */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">ID do Pedido</label>
          <div className="relative">
            <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="#123456 ou MP-789" value={searchId} onChange={(e) => { setSearchId(e.target.value); setPage(0); }} className="pl-9 w-48 h-9" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Nome do Cliente</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Nome ou email do cliente" value={searchName} onChange={(e) => { setSearchName(e.target.value); setPage(0); }} className="pl-9 w-56 h-9" />
          </div>
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9"><X className="mr-1 h-3.5 w-3.5" /> Limpar</Button>
        )}
      </div>

      {/* Line 2: Marketplace, Period, Value */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Marketplace</label>
          <Select value={marketplaceFilter} onValueChange={(v) => { setMarketplaceFilter(v); setPage(0); }}>
            <SelectTrigger className="w-48 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{marketplaceOptions.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Período</label>
          <Select value={periodFilter} onValueChange={(v) => { setPeriodFilter(v); setPage(0); }}>
            <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{periodOptions.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {periodFilter === "custom" && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                {customRange?.from && customRange?.to ? `${format(customRange.from, "dd/MM")} → ${format(customRange.to, "dd/MM")}` : "Selecionar datas"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="range" selected={customRange} onSelect={(r) => { setCustomRange(r); setPage(0); }} numberOfMonths={2} locale={ptBR} className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
        )}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Valor mín</label>
          <Input type="number" placeholder="0" value={minValue} onChange={(e) => { setMinValue(e.target.value); setPage(0); }} className="w-24 h-9" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Valor máx</label>
          <Input type="number" placeholder="999" value={maxValue} onChange={(e) => { setMaxValue(e.target.value); setPage(0); }} className="w-24 h-9" />
        </div>
      </div>

      {/* Table */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="rounded-xl border border-border bg-card overflow-x-auto">
        {hasActiveFilters && <div className="px-4 py-2 border-b border-border text-sm text-muted-foreground">Exibindo {orders.length} de {totalCount} pedidos</div>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pedido</TableHead>
              <TableHead className="hidden md:table-cell">Cliente</TableHead>
              <TableHead className="hidden sm:table-cell">Marketplace</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Data</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-8 rounded" /></TableCell>
                </TableRow>
              ))
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12">
                  <ShoppingCart className="mx-auto h-10 w-10 text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">Nenhum pedido encontrado</p>
                </TableCell>
              </TableRow>
            ) : (
              orders.map((order) => {
                const customer = order.customer as any;
                const status = statusConfig[order.status] || statusConfig.pending;
                return (
                  <TableRow key={order.id} className="hover:bg-muted/50 transition-colors">
                    <TableCell className="font-medium text-sm">#{order.orderNumber || order.id.slice(0, 8)}</TableCell>
                    <TableCell className="text-sm hidden md:table-cell">{customer?.name || "—"}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {order.marketplace ? <Badge variant="outline" className="text-xs">{order.marketplace}</Badge> : <span className="text-sm text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{order.total ? `R$ ${Number(order.total).toFixed(2)}` : "—"}</TableCell>
                    <TableCell><Badge variant="outline" className={cn("text-xs", status.className)}>{status.label}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground hidden lg:table-cell">{format(new Date(order.createdAt), "dd/MM/yy HH:mm", { locale: ptBR })}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" asChild><Link to={`/orders/${order.id}`}><Eye className="h-4 w-4" /></Link></Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </motion.div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Página {page + 1} de {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}><ChevronLeft className="h-4 w-4 mr-1" /> Anterior</Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>Próximo <ChevronRight className="h-4 w-4 ml-1" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
