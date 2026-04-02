import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { INTEGRATED_MARKETPLACES } from "@/constants/marketplaces";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, GitCompare, Wrench } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";

export default function CatalogSyncPage() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const [marketplace, setMarketplace] = useState("Mercado Livre");

  const { data: listings, isLoading, refetch } = useQuery({
    queryKey: ["catalog-sync", tenantId, marketplace],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from("marketplace_listings")
        .select("*, products!inner(title, sku, status, product_variants(price, stock))")
        .eq("tenant_id", tenantId)
        .eq("marketplace", marketplace)
        .neq("status", "inactive")
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []).map((l: any) => {
        const variants = l.products?.product_variants || [];
        const erpPrice = variants.reduce((max: number, v: any) => Math.max(max, v.price ?? 0), 0);
        const erpStock = variants.reduce((sum: number, v: any) => sum + (v.stock ?? 0), 0);
        return {
          ...l,
          erpPrice,
          erpStock,
          erpStatus: l.products?.status || "active",
          priceDiff: erpPrice !== (l.price ?? 0),
          stockDiff: erpStock !== (l.stock ?? 0),
        };
      });
    },
    enabled: !!tenantId,
  });

  const withDiff = (listings || []).filter((l: any) => l.priceDiff || l.stockDiff);
  const fmt = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
        <h1 className="text-2xl font-bold tracking-tight">Sincronização de Catálogo</h1>
        <p className="text-sm text-muted-foreground">Compare dados do ERP com os anúncios nos marketplaces</p>
      </motion.div>

      <div className="flex flex-wrap gap-3 items-center">
        <Select value={marketplace} onValueChange={setMarketplace}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {INTEGRATED_MARKETPLACES.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Verificar
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold">{listings?.length ?? 0}</p>
            <p className="text-sm text-muted-foreground">Anúncios analisados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-success">{(listings?.length ?? 0) - withDiff.length}</p>
            <p className="text-sm text-muted-foreground">Em sincronia</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-destructive">{withDiff.length}</p>
            <p className="text-sm text-muted-foreground">Com diferenças</p>
          </CardContent>
        </Card>
      </div>

      {withDiff.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitCompare className="h-5 w-5" />
              Diferenças detectadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Preço ERP</TableHead>
                  <TableHead className="text-right">Preço Marketplace</TableHead>
                  <TableHead className="text-right">Estoque ERP</TableHead>
                  <TableHead className="text-right">Estoque Marketplace</TableHead>
                  <TableHead>Diferença</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withDiff.map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.products?.title || "—"}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(l.erpPrice)}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(l.price ?? 0)}</TableCell>
                    <TableCell className="text-right font-mono">{l.erpStock}</TableCell>
                    <TableCell className="text-right font-mono">{l.stock ?? 0}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {l.priceDiff && <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">Preço</Badge>}
                        {l.stockDiff && <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30">Estoque</Badge>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
