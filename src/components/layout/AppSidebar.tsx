import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard, Package, ShoppingCart, Warehouse, Plug,
  DollarSign, BarChart2, Settings, ChevronDown, ChevronLeft, ChevronRight,
  BookOpen, Activity, Zap, AlertTriangle,
} from "lucide-react";

interface MenuItem {
  label: string;
  icon: any;
  path?: string;
  children?: { label: string; path: string; requireEdit?: boolean; requireFinancial?: boolean; requireAdmin?: boolean }[];
  requireFinancial?: boolean;
  requireAdmin?: boolean;
  hideForViewer?: boolean;
}

const menuItems: MenuItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
  {
    label: "Pedidos", icon: ShoppingCart, children: [
      { label: "Todos os Pedidos", path: "/orders" },
      { label: "Picking & Packing", path: "/orders/picking" },
      { label: "Devoluções", path: "/orders/returns" },
    ],
  },
  {
    label: "Produtos", icon: Package, children: [
      { label: "Todos os Produtos", path: "/products" },
      { label: "Cadastrar Produto", path: "/products/new", requireEdit: true },
      { label: "Categorias Internas", path: "/products/categories" },
      { label: "Regras de Preço", path: "/products/price-rules" },
    ],
  },
  {
    label: "Catálogo", icon: BookOpen, children: [
      { label: "Categorias Marketplace", path: "/catalog/categories" },
      { label: "Mapeamento", path: "/catalog/mappings" },
      { label: "Anúncios", path: "/catalog/listings" },
      { label: "Sincronização", path: "/catalog/sync" },
    ],
  },
  {
    label: "Estoque", icon: Warehouse, children: [
      { label: "Visão Geral", path: "/inventory" },
      { label: "Movimentações", path: "/inventory/movements" },
      { label: "Armazéns", path: "/inventory/warehouses" },
    ],
  },
  {
    label: "Marketplaces", icon: Plug, children: [
      { label: "Integrações", path: "/integrations" },
      { label: "Saúde", path: "/integrations/health" },
    ],
  },
  { label: "Operações", icon: AlertTriangle, path: "/operations" },
  { label: "Automação", icon: Zap, path: "/automation" },
  {
    label: "Financeiro", icon: DollarSign, requireFinancial: true, children: [
      { label: "Visão Geral", path: "/financial" },
      { label: "Fluxo de Caixa", path: "/financial/cashflow" },
      { label: "Contas a Pagar", path: "/financial/payables" },
      { label: "Contas a Receber", path: "/financial/receivables" },
    ],
  },
  {
    label: "Relatórios", icon: BarChart2, children: [
      { label: "Vendas", path: "/reports/sales" },
      { label: "Curva ABC", path: "/reports/abc" },
      { label: "Mapa de Calor", path: "/reports/heatmap" },
      { label: "Margem", path: "/reports/margin" },
    ],
  },
  {
    label: "Configurações", icon: Settings, hideForViewer: true, children: [
      { label: "Empresa", path: "/settings/company" },
      { label: "Usuários", path: "/settings/users", requireAdmin: true },
      { label: "Notificações", path: "/settings/notifications" },
    ],
  },
];

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const location = useLocation();
  const { canAccessFinancial, canEditProducts, canManageUsers, canViewOnly } = usePermissions();
  const { profile } = useAuth();

  const { data: tenant } = useQuery({
    queryKey: ["tenant-logo", profile?.tenant_id],
    queryFn: async () => {
      if (!profile?.tenant_id) return null;
      const { data } = await supabase.from("tenants").select("name, logo_url").eq("id", profile.tenant_id).maybeSingle();
      return data;
    },
    enabled: !!profile?.tenant_id,
  });

  const logoUrl = (tenant as any)?.logo_url;

  const toggleGroup = (label: string) => {
    setOpenGroups((prev) =>
      prev.includes(label) ? prev.filter((g) => g !== label) : [...prev, label]
    );
  };

  const isChildActive = (children?: { path: string }[]) =>
    children?.some((c) => location.pathname === c.path);

  const filterChildren = (children: MenuItem["children"]) => {
    if (!children) return [];
    return children.filter((child) => {
      if (child.requireEdit && !canEditProducts) return false;
      if (child.requireFinancial && !canAccessFinancial) return false;
      if (child.requireAdmin && !canManageUsers) return false;
      return true;
    });
  };

  const visibleMenuItems = menuItems.filter((item) => {
    if (item.requireFinancial && !canAccessFinancial) return false;
    if (item.hideForViewer && canViewOnly) return false;
    if (item.children) {
      const visibleChildren = filterChildren(item.children);
      if (visibleChildren.length === 0) return false;
    }
    return true;
  });

  return (
    <aside
      className={cn(
        "flex flex-col h-screen bg-sidebar border-r border-sidebar-border transition-all duration-200 shrink-0",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-between h-14 px-4 border-b border-sidebar-border">
        {!collapsed && (
          logoUrl ? (
            <img src={logoUrl} alt="Logo" className="h-8 max-w-[120px] object-contain" />
          ) : (
            <span className="text-lg font-black tracking-tight text-sidebar-foreground">
              Cine<span className="text-primary">ADS</span>
            </span>
          )
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded-md hover:bg-sidebar-accent text-sidebar-foreground"
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Menu */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
        {visibleMenuItems.map((item) => {
          const Icon = item.icon;
          const hasChildren = !!item.children;
          const filteredChildren = filterChildren(item.children);
          const isOpen = openGroups.includes(item.label) || isChildActive(filteredChildren);

          if (!hasChildren) {
            return (
              <NavLink
                key={item.label}
                to={item.path!}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary border-l-2 border-primary font-medium"
                      : "text-sidebar-foreground hover:bg-sidebar-accent"
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            );
          }

          return (
            <div key={item.label}>
              <button
                onClick={() => !collapsed && toggleGroup(item.label)}
                className={cn(
                  "flex items-center w-full gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isChildActive(filteredChildren)
                    ? "text-primary font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">{item.label}</span>
                    <ChevronDown
                      className={cn("h-3 w-3 transition-transform", isOpen && "rotate-180")}
                    />
                  </>
                )}
              </button>
              {!collapsed && isOpen && (
                <div className="ml-6 mt-1 space-y-1 border-l border-sidebar-border pl-3">
                  {filteredChildren.map((child) => (
                    <NavLink
                      key={child.path}
                      to={child.path}
                      className={({ isActive }) =>
                        cn(
                          "block rounded-md px-3 py-1.5 text-sm transition-colors",
                          isActive
                            ? "text-primary font-medium bg-primary/5"
                            : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent"
                        )
                      }
                    >
                      {child.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-4 py-2">
        <p className="text-xs text-muted-foreground text-center">
          {collapsed ? "v1.0" : "CineADS v1.0"}
        </p>
      </div>
    </aside>
  );
}
