import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Hash, User, RotateCcw, Eye, Check, X as XIcon, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { motion } from "framer-motion";

const statusConfig: Record<string, { label: string; className: string }> = {
  requested: { label: "Solicitada", className: "bg-warning/15 text-warning border-warning/30" },
  analyzing: { label: "Em Análise", className: "bg-info/15 text-info border-info/30" },
  approved: { label: "Aprovada", className: "bg-success/15 text-success border-success/30" },
  rejected: { label: "Recusada", className: "bg-destructive/15 text-destructive border-destructive/30" },
  restocked: { label: "Estoque Reposto", className: "bg-muted text-muted-foreground border-border" },
};

const marketplaceOptions = ["Todos", "Mercado Livre", "Shopee", "Amazon", "Magalu", "Americanas", "Shopify"];

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const t = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return debounced;
}

export default function ReturnsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [searchId, setSearchId] = useState("");
  const [searchName, setSearchName] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [marketplaceFilter, setMarketplaceFilter] = useState("Todos");
  const [selectedReturn, setSelectedReturn] = useState<any>(null);
  const [notes, setNotes] = useState("");
  const [processing, setProcessing] = useState(false);

  const debouncedId = useDebounce(searchId, 400);
  const debouncedName = useDebounce(searchName, 400);

  const hasFilters = debouncedId || debouncedName || statusFilter !== "all" || marketplaceFilter !== "Todos";

  const { data: returns = [], isLoading } = useQuery({
    queryKey: ["returns", profile?.tenant_id, debouncedId, debouncedName, statusFilter, marketplaceFilter],
    queryFn: async () => {
      if (!profile?.tenant_id) return [];
      let query = supabase
        .from("returns")
        .select("*, orders!inner(id, order_number, marketplace, customer, order_items(id, product_variant_id, quantity, title))")
        .eq("tenant_id", profile.tenant_id);

      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      if (marketplaceFilter !== "Todos") query = query.eq("orders.marketplace", marketplaceFilter);
      if (debouncedId) query = query.ilike("orders.order_number", `%${debouncedId}%`);
      if (debouncedName) query = query.ilike("orders.customer->>name", `%${debouncedName}%`);

      query = query.order("created_at", { ascending: false });
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!profile?.tenant_id,
  });

  const clearFilters = () => { setSearchId(""); setSearchName(""); setStatusFilter("all"); setMarketplaceFilter("Todos"); };

  const updateStatus = async (id: string, status: string) => {
    const updateData: any = { status };
    if (["approved", "rejected", "restocked"].includes(status)) updateData.resolved_at = new Date().toISOString();
    if (notes) updateData.notes = notes;
    const { error } = await supabase.from("returns").update(updateData).eq("id", id);
    if (error) { toast.error("Erro ao atualizar devolução"); return; }
    toast.success(`Devolução ${statusConfig[status]?.label || status}`);
    setSelectedReturn(null); setNotes("");
    queryClient.invalidateQueries({ queryKey: ["returns"] });
  };

  const handleRestoreStock = async (returnItem: any) => {
    if (!profile?.tenant_id) return;
    setProcessing(true);
    try {
      const { error: returnError } = await supabase.from("returns").update({ status: "restocked", resolved_at: new Date().toISOString(), notes: notes || undefined }).eq("id", returnItem.id);
      if (returnError) throw returnError;
      const orderItems = returnItem.orders?.order_items || [];
      let totalRestored = 0;
      for (const item of orderItems) {
        if (!item.product_variant_id) continue;
        const { data: variant } = await supabase.from("product_variants").select("stock").eq("id", item.product_variant_id).maybeSingle();
        const newStock = (variant?.stock || 0) + item.quantity;
        await supabase.from("product_variants").update({ stock: newStock }).eq("id", item.product_variant_id);
        await supabase.from("stock_movements").insert({ tenant_id: profile.tenant_id, product_variant_id: item.product_variant_id, type: "return", quantity: item.quantity, reference_id: returnItem.id, reason: "Estoque reposto por devolução aprovada" });
        totalRestored += item.quantity;
      }
      toast.success(`Estoque reposto com sucesso! +${totalRestored} unidade(s) adicionada(s)`);
      setSelectedReturn(null); setNotes("");
      queryClient.invalidateQueries({ queryKey: ["returns"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    } catch (err: any) { toast.error("Erro ao repor estoque: " + err.message); }
    finally { setProcessing(false); }
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
        <h1 className="text-2xl font-bold tracking-tight">Devoluções</h1>
        <p className="text-sm text-muted-foreground">{returns.length} devolução(ões) encontrada(s)</p>
      </motion.div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">ID do Pedido</label>
          <div className="relative">
            <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="#123456" value={searchId} onChange={(e) => setSearchId(e.target.value)} className="pl-9 w-40 h-9" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Nome do Cliente</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Nome do cliente" value={searchName} onChange={(e) => setSearchName(e.target.value)} className="pl-9 w-48 h-9" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Status</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="requested">Solicitada</SelectItem>
              <SelectItem value="analyzing">Em Análise</SelectItem>
              <SelectItem value="approved">Aprovada</SelectItem>
              <SelectItem value="rejected">Recusada</SelectItem>
              <SelectItem value="restocked">Estoque Reposto</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Marketplace</label>
          <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
            <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{marketplaceOptions.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}><XIcon className="mr-1 h-3.5 w-3.5" /> Limpar filtros</Button>
        )}
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="rounded-xl border border-border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#Pedido</TableHead>
              <TableHead className="hidden md:table-cell">Cliente</TableHead>
              <TableHead className="hidden sm:table-cell">Marketplace</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Data</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : returns.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12"><RotateCcw className="mx-auto h-10 w-10 text-muted-foreground mb-2" /><p className="text-muted-foreground">Nenhuma devolução encontrada</p></TableCell></TableRow>
            ) : (
              returns.map((r: any) => {
                const st = statusConfig[r.status] || statusConfig.requested;
                const customer = r.orders?.customer as any;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-sm">#{r.orders?.order_number || "—"}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm">{customer?.name || "—"}</TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">{r.orders?.marketplace || "—"}</TableCell>
                    <TableCell className="text-sm max-w-40 truncate">{r.reason || "—"}</TableCell>
                    <TableCell><Badge variant="outline" className={cn("text-xs", st.className)}>{st.label}</Badge></TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{format(new Date(r.created_at), "dd/MM/yy", { locale: ptBR })}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => { setSelectedReturn(r); setNotes(r.notes || ""); }}><Eye className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </motion.div>

      <Dialog open={!!selectedReturn} onOpenChange={() => setSelectedReturn(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Devolução — Pedido #{selectedReturn?.orders?.order_number || "—"}</DialogTitle></DialogHeader>
          {selectedReturn && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Marketplace:</span> <span className="font-medium">{selectedReturn.orders?.marketplace || "—"}</span></div>
                <div><span className="text-muted-foreground">Status:</span> <Badge variant="outline" className={cn("text-xs ml-1", (statusConfig[selectedReturn.status] || statusConfig.requested).className)}>{(statusConfig[selectedReturn.status] || statusConfig.requested).label}</Badge></div>
              </div>
              {selectedReturn.orders?.order_items?.length > 0 && (
                <div className="space-y-2">
                  <Label>Itens da Devolução</Label>
                  <div className="text-sm space-y-1 p-3 rounded bg-muted">
                    {selectedReturn.orders.order_items.map((item: any) => (
                      <div key={item.id} className="flex justify-between"><span>{item.title || "Produto"}</span><span className="font-medium">{item.quantity}x</span></div>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-2"><Label>Motivo</Label><p className="text-sm p-3 rounded bg-muted">{selectedReturn.reason || "Não informado"}</p></div>
              <div className="space-y-2"><Label>Notas Internas</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Adicionar notas..." rows={3} /></div>
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            {selectedReturn?.status === "requested" && <Button variant="outline" onClick={() => updateStatus(selectedReturn.id, "analyzing")}>Iniciar Análise</Button>}
            {(selectedReturn?.status === "requested" || selectedReturn?.status === "analyzing") && (
              <>
                <Button className="bg-success hover:bg-success/90 text-white" onClick={() => updateStatus(selectedReturn.id, "approved")}><Check className="mr-2 h-4 w-4" /> Aprovar</Button>
                <Button variant="destructive" onClick={() => updateStatus(selectedReturn.id, "rejected")}><XIcon className="mr-2 h-4 w-4" /> Recusar</Button>
              </>
            )}
            {selectedReturn?.status === "approved" && (
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => handleRestoreStock(selectedReturn)} disabled={processing}>
                <Package className="mr-2 h-4 w-4" /> {processing ? "Processando..." : "Marcar Estoque Reposto"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
