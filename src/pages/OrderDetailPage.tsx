import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, Package, User, MapPin, Clock, Truck, CheckCircle2, XCircle, CreditCard, CircleDot, PackageSearch, Printer, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useState } from "react";

const statusConfig: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  pending: { label: "Pendente", className: "bg-warning/15 text-warning border-warning/30", icon: Clock },
  paid: { label: "Pago", className: "bg-info/15 text-info border-info/30", icon: CreditCard },
  in_separation: { label: "Em Separação", className: "bg-purple-500/15 text-purple-400 border-purple-500/30", icon: PackageSearch },
  processing: { label: "Faturado", className: "bg-primary/15 text-primary border-primary/30", icon: Package },
  shipped: { label: "Enviado", className: "bg-accent/15 text-accent-foreground border-accent/30", icon: Truck },
  delivered: { label: "Entregue", className: "bg-success/15 text-success border-success/30", icon: CheckCircle2 },
  cancelled: { label: "Cancelado", className: "bg-destructive/15 text-destructive border-destructive/30", icon: XCircle },
};

const timelineSteps = ["pending", "paid", "in_separation", "processing", "shipped", "delivered"];

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showLabelModal, setShowLabelModal] = useState(false);
  const [showNfeModal, setShowNfeModal] = useState(false);
  const [nfeNumber, setNfeNumber] = useState("");
  const [nfeKey, setNfeKey] = useState("");

  const { data: order, isLoading } = useQuery({
    queryKey: ["order", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("orders")
        .select("*, order_items(id, title, quantity, price, product_variant_id)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id && !!profile?.tenant_id,
  });

  const { data: invoice } = useQuery({
    queryKey: ["invoice", id],
    queryFn: async () => {
      if (!id) return null;
      const { data } = await supabase
        .from("invoices")
        .select("*")
        .eq("order_id", id)
        .maybeSingle();
      return data;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Pedido não encontrado</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/orders")}>Voltar aos pedidos</Button>
      </div>
    );
  }

  const customer = order.customer as any;
  const status = statusConfig[order.status] || statusConfig.pending;
  const StatusIcon = status.icon;
  const currentStepIndex = timelineSteps.indexOf(order.status);
  const isCancelled = order.status === "cancelled";

  const updateStatus = async (newStatus: string) => {
    const { error } = await supabase.from("orders").update({ status: newStatus }).eq("id", order.id);
    if (error) { toast.error("Erro ao atualizar status"); return; }
    await supabase.from("order_timeline").insert({ order_id: order.id, status: newStatus, message: `Status atualizado para ${statusConfig[newStatus]?.label || newStatus}` });
    toast.success(`Status atualizado para "${statusConfig[newStatus]?.label || newStatus}"`);
    queryClient.invalidateQueries({ queryKey: ["order", id] });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  };

  const handleCancel = async () => {
    await updateStatus("cancelled");
    setShowCancelDialog(false);
  };

  const handleSaveNfe = async () => {
    if (!profile?.tenant_id) return;
    const payload = {
      order_id: order.id,
      tenant_id: profile.tenant_id,
      nfe_number: nfeNumber,
      nfe_key: nfeKey,
      status: "issued" as const,
      issued_at: new Date().toISOString(),
    };
    if (invoice) {
      await supabase.from("invoices").update(payload).eq("id", invoice.id);
    } else {
      await supabase.from("invoices").insert(payload);
    }
    toast.success("Nota fiscal registrada!");
    queryClient.invalidateQueries({ queryKey: ["invoice", id] });
    setShowNfeModal(false);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/orders")} aria-label="Voltar para pedidos"><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Pedido #{order.order_number || order.id.slice(0, 8)}</h1>
            <p className="text-sm text-muted-foreground">Criado em {format(new Date(order.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
          </div>
        </div>
        <Badge variant="outline" className={cn("text-sm px-3 py-1", status.className)}><StatusIcon className="mr-1.5 h-3.5 w-3.5" />{status.label}</Badge>
      </div>

      {/* Timeline */}
      {!isCancelled && (
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-sm font-medium mb-4">Progresso do Pedido</h3>
          <div className="flex items-center justify-between">
            {timelineSteps.map((step, i) => {
              const stepConfig = statusConfig[step];
              const StepIcon = stepConfig.icon;
              const isCompleted = i <= currentStepIndex;
              const isCurrent = i === currentStepIndex;
              return (
                <div key={step} className="flex items-center flex-1">
                  <div className="flex flex-col items-center gap-1.5">
                    <div className={cn("h-8 w-8 rounded-full flex items-center justify-center border-2 transition-colors", isCurrent ? "border-primary bg-primary text-primary-foreground" : isCompleted ? "border-success bg-success/20 text-success" : "border-muted bg-muted/50 text-muted-foreground")}>
                      <StepIcon className="h-4 w-4" />
                    </div>
                    <span className={cn("text-xs", isCurrent ? "text-primary font-medium" : isCompleted ? "text-success" : "text-muted-foreground")}>{stepConfig.label}</span>
                  </div>
                  {i < timelineSteps.length - 1 && <div className={cn("flex-1 h-0.5 mx-2 mt-[-20px]", i < currentStepIndex ? "bg-success" : "bg-muted")} />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isCancelled && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 flex items-center gap-3">
          <XCircle className="h-5 w-5 text-destructive" />
          <p className="text-sm text-destructive">Este pedido foi cancelado.</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        {!isCancelled && (
          <>
            {order.status === "paid" && (
              <Button onClick={() => updateStatus("in_separation")} className="bg-purple-600 hover:bg-purple-700 text-white">
                <PackageSearch className="mr-2 h-4 w-4" /> Mover para Em Separação
              </Button>
            )}
            {order.status === "in_separation" && (
              <Button onClick={() => updateStatus("processing")}><Package className="mr-2 h-4 w-4" /> Faturar Pedido</Button>
            )}
            {order.status === "processing" && (
              <Button onClick={() => updateStatus("shipped")}><Truck className="mr-2 h-4 w-4" /> Marcar como Enviado</Button>
            )}
            {order.status === "shipped" && (
              <Button onClick={() => updateStatus("delivered")} className="bg-success hover:bg-success/90 text-white">
                <CheckCircle2 className="mr-2 h-4 w-4" /> Marcar como Entregue
              </Button>
            )}
            <Button variant="outline" onClick={() => setShowLabelModal(true)}>
              <Printer className="mr-2 h-4 w-4" /> Imprimir Etiqueta
            </Button>
            <Button variant="outline" onClick={() => { setNfeNumber(invoice?.nfe_number || ""); setNfeKey(invoice?.nfe_key || ""); setShowNfeModal(true); }}>
              <FileText className="mr-2 h-4 w-4" /> {invoice ? "Ver NF" : "Emitir NF"}
            </Button>
            {order.status !== "delivered" && (
              <Button variant="destructive" onClick={() => setShowCancelDialog(true)}>
                <XCircle className="mr-2 h-4 w-4" /> Cancelar Pedido
              </Button>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-6 space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" /> Cliente</h3>
          <div className="space-y-1 text-sm">
            <p className="font-medium">{customer?.name || "Não informado"}</p>
            {customer?.email && <p className="text-muted-foreground">{customer.email}</p>}
            {customer?.phone && <p className="text-muted-foreground">{customer.phone}</p>}
            {customer?.cpf && <p className="text-muted-foreground">CPF: {customer.cpf}</p>}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /> Endereço de Entrega</h3>
          <div className="space-y-1 text-sm text-muted-foreground">
            {customer?.address ? (
              <>
                <p>{customer.address.street}, {customer.address.number}</p>
                {customer.address.complement && <p>{customer.address.complement}</p>}
                <p>{customer.address.city} - {customer.address.state}</p>
                <p>CEP: {customer.address.zip}</p>
              </>
            ) : (<p>Endereço não informado</p>)}
          </div>
        </div>
      </div>

      {/* Order Items */}
      <div className="rounded-xl border border-border bg-card">
        <div className="p-4 border-b border-border"><h3 className="text-sm font-medium">Itens do Pedido</h3></div>
        <Table>
          <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead className="text-right">Qtd</TableHead><TableHead className="text-right">Preço Unit.</TableHead><TableHead className="text-right">Subtotal</TableHead></TableRow></TableHeader>
          <TableBody>
            {order.order_items?.length ? order.order_items.map((item: any) => (
              <TableRow key={item.id}>
                <TableCell className="text-sm font-medium">{item.title || "Produto"}</TableCell>
                <TableCell className="text-sm text-right">{item.quantity}</TableCell>
                <TableCell className="text-sm text-right">R$ {Number(item.price || 0).toFixed(2)}</TableCell>
                <TableCell className="text-sm text-right font-medium">R$ {(item.quantity * Number(item.price || 0)).toFixed(2)}</TableCell>
              </TableRow>
            )) : (
              <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Nenhum item registrado</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        <div className="p-4 border-t border-border flex justify-end">
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Total</p>
            <p className="text-xl font-bold">R$ {Number(order.total || 0).toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Order metadata */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-2">
        <h3 className="text-sm font-medium mb-3">Informações Adicionais</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-muted-foreground">Marketplace:</span> <span className="font-medium">{order.marketplace || "—"}</span></div>
          <div><span className="text-muted-foreground">Atualizado em:</span> <span className="font-medium">{format(new Date(order.updated_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</span></div>
        </div>
      </div>

      {/* Cancel AlertDialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar Pedido</AlertDialogTitle>
            <AlertDialogDescription>Tem certeza que deseja cancelar este pedido? Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Sim, cancelar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Print Label Modal */}
      <Dialog open={showLabelModal} onOpenChange={setShowLabelModal}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Etiqueta de Envio</DialogTitle></DialogHeader>
          <div className="border border-border rounded-lg p-6 space-y-3 print-label">
            <div className="border-b border-border pb-3">
              <p className="text-xs text-muted-foreground">DESTINATÁRIO</p>
              <p className="font-bold">{customer?.name || "—"}</p>
              {customer?.address && (
                <>
                  <p className="text-sm">{customer.address.street}, {customer.address.number}</p>
                  {customer.address.complement && <p className="text-sm">{customer.address.complement}</p>}
                  <p className="text-sm">{customer.address.city} - {customer.address.state}</p>
                  <p className="text-sm font-mono">CEP: {customer.address.zip}</p>
                </>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">PEDIDO</p>
              <p className="font-mono font-bold text-lg">#{order.order_number || order.id.slice(0, 8)}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLabelModal(false)}>Fechar</Button>
            <Button onClick={() => window.print()}>Imprimir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* NF-e Modal */}
      <Dialog open={showNfeModal} onOpenChange={setShowNfeModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>{invoice ? "Nota Fiscal Registrada" : "Emitir Nota Fiscal"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="text-sm space-y-1">
              <p><span className="text-muted-foreground">Pedido:</span> #{order.order_number || order.id.slice(0, 8)}</p>
              <p><span className="text-muted-foreground">Valor:</span> R$ {Number(order.total || 0).toFixed(2)}</p>
              <p><span className="text-muted-foreground">Itens:</span> {order.order_items?.length || 0}</p>
            </div>
            <div className="space-y-2">
              <Label>Número da NF</Label>
              <Input placeholder="000001" value={nfeNumber} onChange={(e) => setNfeNumber(e.target.value)} disabled={!!invoice} />
            </div>
            <div className="space-y-2">
              <Label>Chave de Acesso NF-e (44 dígitos)</Label>
              <Input placeholder="0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000" value={nfeKey} onChange={(e) => setNfeKey(e.target.value)} maxLength={44} disabled={!!invoice} />
            </div>
            {invoice && <Badge variant="outline" className="bg-success/15 text-success border-success/30">NF emitida em {format(new Date(invoice.issued_at!), "dd/MM/yyyy HH:mm")}</Badge>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNfeModal(false)}>Fechar</Button>
            {!invoice && <Button onClick={handleSaveNfe} disabled={!nfeNumber}>Registrar NF</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
