import { useQuery, useQueryClient } from "@tanstack/react-query";
import { productsService } from "@/services/products.service";
import { marketplaceService } from "@/services/marketplace.service";
import { useAuth } from "@/lib/auth";
import { useState, useEffect } from "react";
import { MARKETPLACE_NAMES } from "@/constants/marketplaces";
import { Link, useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Search, Package, Trash2, Play, Pause, X, FilterX, DollarSign } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { motion, AnimatePresence } from "framer-motion";

const statusConfig: Record<string, { label: string; className: string }> = {
  active: { label: "Ativo", className: "bg-success/15 text-success border-success/30" },
  paused: { label: "Pausado", className: "bg-warning/15 text-warning border-warning/30" },
  draft: { label: "Rascunho", className: "bg-muted text-muted-foreground border-border" },
  inactive: { label: "Inativo", className: "bg-destructive/15 text-destructive border-destructive/30" },
};

const marketplaces = MARKETPLACE_NAMES;

export default function ProductsPage() {
  const { profile } = useAuth();
  const { canEditProducts, canViewOnly } = usePermissions();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [marketplaceFilter, setMarketplaceFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => { setPage(0); }, [search, statusFilter, categoryFilter, marketplaceFilter]);

  const { data: categories } = useQuery({
    queryKey: ["categories", profile?.tenant_id],
    queryFn: async () => {
      if (!profile?.tenant_id) return [];
      return productsService.listCategories(profile.tenant_id);
    },
    enabled: !!profile?.tenant_id,
  });

  const { data: productsData, isLoading } = useQuery({
    queryKey: ["products", profile?.tenant_id, categoryFilter, marketplaceFilter, page],
    queryFn: async () => {
      if (!profile?.tenant_id) return { data: [], count: 0 };
      const result = await productsService.listProducts({
        tenantId: profile.tenant_id,
        categoryId: categoryFilter,
        page,
        pageSize: PAGE_SIZE,
      });

      if (marketplaceFilter !== "all" && result.data) {
        const productIds = result.data.map((p: any) => p.id);
        if (productIds.length === 0) return { data: [], count: 0 };
        const listings = await marketplaceService.getListingsForProducts(productIds);
        const matchedIds = new Set(
          listings
            .filter((l: any) => l.marketplace_integrations?.marketplace === marketplaceFilter)
            .map((l: any) => l.product_id)
        );
        const filtered = result.data.filter((p: any) => matchedIds.has(p.id));
        return { data: filtered, count: filtered.length };
      }

      return result;
    },
    enabled: !!profile?.tenant_id,
  });

  const products = productsData?.data || [];
  const totalCount = productsData?.count || 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Fetch active price rules for badge display
  const { data: activeRules } = useQuery({
    queryKey: ["active-price-rules", profile?.tenant_id],
    queryFn: async () => {
      if (!profile?.tenant_id) return [];
      return productsService.listActivePriceRules(profile.tenant_id);
    },
    enabled: !!profile?.tenant_id,
  });

  const getActiveRuleForProduct = (productId: string, sku?: string) => {
    if (!activeRules?.length) return null;
    return (activeRules as any[]).find(rule => {
      const scope = rule.scope || {};
      if (scope.skus?.length > 0) {
        return scope.skus.some((s: string) => s.toUpperCase() === sku?.toUpperCase());
      }
      return true; // broad rule applies to all
    });
  };

  const filtered = (products || []).filter((p) => {
    const matchSearch = !search || p.title.toLowerCase().includes(search.toLowerCase()) || p.sku?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const hasActiveFilters = statusFilter !== "all" || categoryFilter !== "all" || marketplaceFilter !== "all" || !!search;

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setCategoryFilter("all");
    setMarketplaceFilter("all");
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((p) => p.id)));
  };

  const bulkUpdateStatus = async (status: string) => {
    const ids = Array.from(selected);
    await productsService.bulkUpdateProductStatus(ids, status);
    toast.success(`${ids.length} produtos atualizados para ${statusConfig[status]?.label || status}`);
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const bulkDelete = async () => {
    const ids = Array.from(selected);
    await productsService.bulkDeleteProducts(ids);
    toast.success(`${ids.length} produtos excluídos`);
    setSelected(new Set());
    setShowDeleteDialog(false);
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Produtos</h1>
          <p className="text-sm text-muted-foreground">
            {hasActiveFilters ? `${filtered.length} produtos encontrados` : `${(products || []).length} produtos`}
          </p>
        </div>
        {canEditProducts && (
          <Button asChild><Link to="/products/new"><Plus className="mr-2 h-4 w-4" /> Cadastrar Produto</Link></Button>
        )}
      </motion.div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome ou SKU..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Ativo</SelectItem>
            <SelectItem value="paused">Pausado</SelectItem>
            <SelectItem value="draft">Rascunho</SelectItem>
            <SelectItem value="inactive">Inativo</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            {(categories || []).map((c: any) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Marketplace" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {marketplaces.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="text-xs h-9" onClick={clearFilters}>
            <FilterX className="h-3.5 w-3.5 mr-1" /> Limpar filtros
          </Button>
        )}
      </div>

      {/* Bulk Actions Bar */}
      <AnimatePresence>
        {selected.size > 0 && canEditProducts && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex items-center gap-3 p-3 rounded-xl border border-primary/30 bg-primary/5">
            <span className="text-sm font-medium">{selected.size} selecionado(s)</span>
            <div className="flex gap-2 flex-1">
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => bulkUpdateStatus("active")}><Play className="h-3 w-3 mr-1" /> Ativar</Button>
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => bulkUpdateStatus("paused")}><Pause className="h-3 w-3 mr-1" /> Pausar</Button>
              <Button size="sm" variant="destructive" className="text-xs h-7" onClick={() => setShowDeleteDialog(true)}><Trash2 className="h-3 w-3 mr-1" /> Excluir</Button>
            </div>
            <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setSelected(new Set())}><X className="h-3 w-3 mr-1" /> Cancelar</Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="rounded-xl border border-border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {canEditProducts && <TableHead className="w-10"><Checkbox checked={filtered.length > 0 && selected.size === filtered.length} onCheckedChange={toggleAll} /></TableHead>}
              <TableHead>Produto</TableHead>
              <TableHead className="hidden sm:table-cell">SKU</TableHead>
              <TableHead>Preço</TableHead>
              <TableHead>Estoque</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto mb-2" />Carregando...
              </TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12">
                <Package className="mx-auto h-10 w-10 text-muted-foreground mb-2" /><p className="text-muted-foreground">Nenhum produto encontrado</p>
              </TableCell></TableRow>
            ) : (
              filtered.map((product) => {
                const primaryImage = product.images?.find((img: any) => img.isPrimary)?.url || product.images?.[0]?.url;
                const firstVariant = product.variants?.[0];
                const totalStock = product.variants?.reduce((sum: number, v: any) => sum + (v.stock || 0), 0) || 0;
                const status = statusConfig[product.status] || statusConfig.draft;
                const activeRule = getActiveRuleForProduct(product.id, product.sku);

                return (
                  <TableRow key={product.id} className="hover:bg-muted/50 transition-colors">
                    {canEditProducts && <TableCell><Checkbox checked={selected.has(product.id)} onCheckedChange={() => toggleSelect(product.id)} /></TableCell>}
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {primaryImage ? (
                          <img src={primaryImage} alt={product.title} className="h-10 w-10 rounded-lg object-cover" />
                        ) : (
                          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center"><Package className="h-5 w-5 text-muted-foreground" /></div>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{product.title}</p>
                          {product.brand && <p className="text-xs text-muted-foreground">{product.brand}</p>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">{product.sku || "—"}</TableCell>
                    <TableCell className="text-sm">{firstVariant?.price ? `R$ ${Number(firstVariant.price).toFixed(2)}` : "—"}</TableCell>
                    <TableCell className="text-sm">{totalStock}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className={cn("text-xs", status.className)}>{status.label}</Badge>
                        {activeRule && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Link to="/products/price-rules">
                                <Badge variant="outline" className="text-xs bg-yellow-500/15 text-yellow-600 border-yellow-500/30 cursor-pointer">
                                  <DollarSign className="h-3 w-3 mr-0.5" />Regra
                                </Badge>
                              </Link>
                            </TooltipTrigger>
                            <TooltipContent><p className="text-xs">{activeRule.name}{activeRule.ends_at ? ` • até ${new Date(activeRule.ends_at).toLocaleDateString("pt-BR")}` : ""}</p></TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </motion.div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Página {page + 1} de {totalPages} ({totalCount} produtos)
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Próximo</Button>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {selected.size} produto(s)?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita. Todos os produtos selecionados serão removidos permanentemente.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={bulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
