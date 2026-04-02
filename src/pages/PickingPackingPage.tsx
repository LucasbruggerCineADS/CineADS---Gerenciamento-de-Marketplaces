import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Package, CheckCircle2, Truck, ArrowRight, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useState, useRef } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function PickingPackingPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const printRef = useRef<HTMLDivElement>(null);

  const { data: orders, isLoading } = useQuery({
    queryKey: ["orders-picking", profile?.tenant_id],
    queryFn: async () => {
      if (!profile?.tenant_id) return [];
      const { data, error } = await supabase
        .from("orders")
        .select("*, order_items(id, title, quantity, price), order_shipping(address, tracking_code, carrier)")
        .eq("tenant_id", profile.tenant_id)
        .in("status", ["paid", "processing"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!profile?.tenant_id,
  });

  const { data: tenant } = useQuery({
    queryKey: ["tenant-name", profile?.tenant_id],
    queryFn: async () => {
      if (!profile?.tenant_id) return null;
      const { data } = await supabase.from("tenants").select("name").eq("id", profile.tenant_id).maybeSingle();
      return data;
    },
    enabled: !!profile?.tenant_id,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: string }) => {
      if (!profile?.tenant_id) throw new Error("Sessão inválida");
      const { error } = await supabase.from("orders").update({ status }).eq("id", orderId).eq("tenant_id", profile.tenant_id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders-picking"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Status do pedido atualizado!");
    },
    onError: (err: any) => toast.error("Erro ao atualizar: " + err.message),
  });

  const toggleItem = (itemId: string) => {
    setCheckedItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const areAllItemsChecked = (orderItems: any[]) => orderItems.every((item: any) => checkedItems[item.id]);

  const handleAdvanceStatus = (orderId: string, currentStatus: string) => {
    const nextStatus = currentStatus === "paid" ? "processing" : "shipped";
    updateStatus.mutate({ orderId, status: nextStatus });
  };

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrders((prev) => {
      const next = new Set(prev);
      next.has(orderId) ? next.delete(orderId) : next.add(orderId);
      return next;
    });
  };

  const handleBatchPrint = () => {
    if (selectedOrders.size === 0) { toast.error("Selecione ao menos um pedido"); return; }
    window.print();
  };

  const paidOrders = (orders || []).filter((o) => o.status === "paid");
  const processingOrders = (orders || []).filter((o) => o.status === "processing");
  const selectedOrdersData = (orders || []).filter((o) => selectedOrders.has(o.id));
  const companyName = tenant?.name || "CineADS";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between no-print">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Picking & Packing</h1>
          <p className="text-sm text-muted-foreground">
            {(orders || []).length} pedidos aguardando separação ou envio
          </p>
        </div>
        {selectedOrders.size > 0 && (
          <Button onClick={handleBatchPrint}>
            <Printer className="mr-2 h-4 w-4" /> Imprimir {selectedOrders.size} Etiqueta(s)
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 no-print">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (orders || []).length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center no-print">
          <CheckCircle2 className="mx-auto h-12 w-12 text-success mb-3" />
          <p className="text-lg font-medium">Tudo em dia!</p>
          <p className="text-sm text-muted-foreground">Nenhum pedido aguardando separação ou envio.</p>
        </div>
      ) : (
        <div className="space-y-8 no-print">
          {paidOrders.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Package className="h-5 w-5 text-info" /> Aguardando Separação
                <Badge variant="outline" className="bg-info/15 text-info border-info/30">{paidOrders.length}</Badge>
              </h2>
              {paidOrders.map((order) => {
                const customer = order.customer as any;
                const allChecked = areAllItemsChecked(order.order_items || []);
                return (
                  <div key={order.id} className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
                      <div className="flex items-center gap-4">
                        <Checkbox checked={selectedOrders.has(order.id)} onCheckedChange={() => toggleOrderSelection(order.id)} />
                        <span className="font-mono text-sm font-medium">#{order.order_number || order.id.slice(0, 8)}</span>
                        <span className="text-sm text-muted-foreground">{customer?.name || "Cliente"}</span>
                        {order.marketplace && <Badge variant="outline" className="text-xs">{order.marketplace}</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{format(new Date(order.created_at), "dd/MM HH:mm", { locale: ptBR })}</span>
                        <Button size="sm" disabled={!allChecked || updateStatus.isPending} onClick={() => handleAdvanceStatus(order.id, order.status)}>
                          Iniciar Packing <ArrowRight className="ml-1 h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <Table>
                      <TableBody>
                        {order.order_items?.map((item: any) => (
                          <TableRow key={item.id}>
                            <TableCell className="w-12"><Checkbox checked={!!checkedItems[item.id]} onCheckedChange={() => toggleItem(item.id)} /></TableCell>
                            <TableCell className={cn("text-sm", checkedItems[item.id] && "line-through text-muted-foreground")}>{item.title || "Produto"}</TableCell>
                            <TableCell className="text-sm text-right font-medium">{item.quantity}x</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                );
              })}
            </div>
          )}

          {processingOrders.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Truck className="h-5 w-5 text-primary" /> Pronto para Envio
                <Badge variant="outline" className="bg-primary/15 text-primary border-primary/30">{processingOrders.length}</Badge>
              </h2>
              {processingOrders.map((order) => {
                const customer = order.customer as any;
                return (
                  <div key={order.id} className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-4">
                        <Checkbox checked={selectedOrders.has(order.id)} onCheckedChange={() => toggleOrderSelection(order.id)} />
                        <span className="font-mono text-sm font-medium">#{order.order_number || order.id.slice(0, 8)}</span>
                        <span className="text-sm text-muted-foreground">{customer?.name || "Cliente"}</span>
                        <span className="text-xs text-muted-foreground">{order.order_items?.length || 0} item(s)</span>
                      </div>
                      <Button size="sm" onClick={() => handleAdvanceStatus(order.id, order.status)} disabled={updateStatus.isPending}>
                        Marcar Enviado <Truck className="ml-1 h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Print-only labels */}
      <div className="hidden print:block">
        {selectedOrdersData.map((order, idx) => {
          const customer = order.customer as any;
          const shipping = (order as any).order_shipping?.[0];
          const address = shipping?.address as any;
          return (
            <div key={order.id} className="print-label p-8 border-2 border-black" style={{ pageBreakAfter: idx < selectedOrdersData.length - 1 ? "always" : "auto" }}>
              <div className="text-center mb-6">
                <h2 className="text-xl font-bold">{companyName}</h2>
                <p className="text-sm">Etiqueta de Envio</p>
              </div>
              <div className="border-t border-b border-black py-4 my-4 space-y-2">
                <p className="text-lg font-bold">DESTINATÁRIO</p>
                <p className="text-base font-semibold">{customer?.name || "—"}</p>
                {address && (
                  <>
                    <p>{address.street || ""}{address.number ? `, ${address.number}` : ""}</p>
                    {address.complement && <p>{address.complement}</p>}
                    <p>{address.neighborhood || ""}</p>
                    <p>{address.city || ""} - {address.state || ""}</p>
                  </>
                )}
                <p className="text-lg font-bold">CEP: {address?.zip || customer?.zip || "—"}</p>
              </div>
              <div className="space-y-1 text-sm">
                <p><strong>Pedido:</strong> #{order.order_number || order.id.slice(0, 8)}</p>
                {order.marketplace && <p><strong>Marketplace:</strong> {order.marketplace}</p>}
                {shipping?.tracking_code && <p><strong>Rastreio:</strong> {shipping.tracking_code}</p>}
                {shipping?.carrier && <p><strong>Transportadora:</strong> {shipping.carrier}</p>}
                <p><strong>Itens:</strong> {order.order_items?.length || 0}</p>
              </div>
              <div className="text-center mt-6 font-mono text-xs tracking-widest">
                {order.order_number || order.id.slice(0, 12)}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-label { page-break-after: always; }
        }
      `}</style>
    </div>
  );
}
