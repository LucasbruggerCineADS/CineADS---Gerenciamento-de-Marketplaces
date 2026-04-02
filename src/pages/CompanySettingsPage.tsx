import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useState, useEffect, useRef } from "react";
import { Building2, Upload, ImageIcon, MapPin } from "lucide-react";

const estados = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

function formatPhone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0,2)}) ${d.slice(2)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
}

function formatCep(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0,5)}-${d.slice(5)}`;
}

export default function CompanySettingsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [phone, setPhone] = useState("");
  const [cep, setCep] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: tenant, isLoading } = useQuery({
    queryKey: ["tenant", profile?.tenant_id],
    queryFn: async () => {
      if (!profile?.tenant_id) return null;
      const { data, error } = await supabase.from("tenants").select("*").eq("id", profile.tenant_id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!profile?.tenant_id,
  });

  useEffect(() => {
    if (tenant) {
      setName(tenant.name || "");
      setCnpj(tenant.cnpj || "");
      setPhone((tenant as any).phone || "");
      if ((tenant as any).logo_url) setLogoPreview((tenant as any).logo_url);
      const addr = (tenant as any).address || {};
      setCep(addr.cep || "");
      setStreet(addr.street || "");
      setNumber(addr.number || "");
      setComplement(addr.complement || "");
      setNeighborhood(addr.neighborhood || "");
      setCity(addr.city || "");
      setState(addr.state || "");
    }
  }, [tenant]);

  const updateTenant = useMutation({
    mutationFn: async () => {
      if (!profile?.tenant_id) return;
      const { error } = await supabase.from("tenants").update({
        name, cnpj, phone, address: { cep, street, number, complement, neighborhood, city, state },
      } as any).eq("id", profile.tenant_id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["tenant"] }); toast.success("Dados da empresa atualizados!"); },
    onError: (err: any) => toast.error("Erro: " + err.message),
  });

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile?.tenant_id) return;
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    setUploading(true);
    try {
      const path = `${profile.tenant_id}/logo.png`;
      const { error } = await supabase.storage.from("company-logos").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("company-logos").getPublicUrl(path);
      const publicUrl = urlData.publicUrl + "?t=" + Date.now();
      await supabase.from("tenants").update({ logo_url: publicUrl } as any).eq("id", profile.tenant_id);
      queryClient.invalidateQueries({ queryKey: ["tenant"] });
      setLogoPreview(publicUrl);
      toast.success("Logo atualizada com sucesso!");
    } catch (err: any) { toast.error("Erro ao enviar logo: " + err.message); }
    finally { setUploading(false); }
  };

  const fetchCep = async (cepValue: string) => {
    const digits = cepValue.replace(/\D/g, "");
    if (digits.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setStreet(data.logradouro || "");
        setNeighborhood(data.bairro || "");
        setCity(data.localidade || "");
        setState(data.uf || "");
      }
    } catch {}
  };

  const initials = name ? name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase() : "CE";

  return (
    <div className="space-y-6 max-w-2xl">
      <div><h1 className="text-2xl font-bold tracking-tight">Configurações da Empresa</h1><p className="text-sm text-muted-foreground">Gerencie as informações da sua empresa</p></div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : (
        <>
          {/* Logo Section */}
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-3 pb-4 border-b border-border mb-4">
              <div className="rounded-lg bg-primary/10 p-2.5"><ImageIcon className="h-5 w-5 text-primary" /></div>
              <div><h2 className="font-semibold">Logo da Empresa</h2><p className="text-xs text-muted-foreground">Imagem exibida na sidebar e relatórios</p></div>
            </div>
            <div className="flex items-center gap-6">
              <div className="h-20 w-20 rounded-xl border-2 border-dashed border-border flex items-center justify-center overflow-hidden bg-muted">
                {logoPreview ? <img src={logoPreview} alt="Logo" className="h-full w-full object-cover" /> : <span className="text-2xl font-bold text-muted-foreground">{initials}</span>}
              </div>
              <div className="space-y-2">
                <input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={handleLogoUpload} />
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}><Upload className="mr-2 h-4 w-4" /> {uploading ? "Enviando..." : "Alterar Logo"}</Button>
                <p className="text-xs text-muted-foreground">PNG ou JPG, máximo 2MB</p>
              </div>
            </div>
          </div>

          {/* Company Data */}
          <div className="rounded-xl border border-border bg-card p-6 space-y-6">
            <div className="flex items-center gap-3 pb-4 border-b border-border">
              <div className="rounded-lg bg-primary/10 p-2.5"><Building2 className="h-5 w-5 text-primary" /></div>
              <div><h2 className="font-semibold">Dados Gerais</h2><p className="text-xs text-muted-foreground">Informações básicas da empresa</p></div>
            </div>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Nome da Empresa</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>CNPJ</Label><Input value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" /></div>
                <div className="space-y-2"><Label>Telefone</Label><Input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="(11) 99999-9999" /></div>
              </div>
              <div className="space-y-2"><Label>Plano</Label><Input value={tenant?.plan || "free"} disabled className="bg-muted" /></div>
            </div>
          </div>

          {/* Address */}
          <div className="rounded-xl border border-border bg-card p-6 space-y-6">
            <div className="flex items-center gap-3 pb-4 border-b border-border">
              <div className="rounded-lg bg-primary/10 p-2.5"><MapPin className="h-5 w-5 text-primary" /></div>
              <div><h2 className="font-semibold">Endereço</h2><p className="text-xs text-muted-foreground">Endereço fiscal da empresa</p></div>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2"><Label>CEP</Label><Input value={cep} onChange={(e) => setCep(formatCep(e.target.value))} onBlur={() => fetchCep(cep)} placeholder="00000-000" /></div>
                <div className="col-span-2 space-y-2"><Label>Rua / Avenida</Label><Input value={street} onChange={(e) => setStreet(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2"><Label>Número</Label><Input value={number} onChange={(e) => setNumber(e.target.value)} /></div>
                <div className="col-span-2 space-y-2"><Label>Complemento</Label><Input value={complement} onChange={(e) => setComplement(e.target.value)} placeholder="Sala, Andar..." /></div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2"><Label>Bairro</Label><Input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} /></div>
                <div className="space-y-2"><Label>Cidade</Label><Input value={city} onChange={(e) => setCity(e.target.value)} /></div>
                <div className="space-y-2">
                  <Label>Estado</Label>
                  <Select value={state} onValueChange={setState}><SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger><SelectContent>{estados.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}</SelectContent></Select>
                </div>
              </div>
            </div>
          </div>

          <Button onClick={() => updateTenant.mutate()} disabled={updateTenant.isPending}>{updateTenant.isPending ? "Salvando..." : "Salvar Alterações"}</Button>
        </>
      )}
    </div>
  );
}
