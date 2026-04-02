import { Moon, Sun, User, LogOut, Menu } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { NotificationsBell } from "./NotificationsBell";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

interface TopbarProps {
  onMenuToggle?: () => void;
  showMenuButton?: boolean;
}

export function Topbar({ onMenuToggle, showMenuButton }: TopbarProps) {
  const { theme, toggleTheme } = useTheme();
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const { data: tenant, isLoading: tenantLoading } = useQuery({
    queryKey: ["tenant-name", profile?.tenant_id],
    queryFn: async () => {
      if (!profile?.tenant_id) return null;
      const { data } = await supabase.from("tenants").select("name").eq("id", profile.tenant_id).maybeSingle();
      return data;
    },
    enabled: !!profile?.tenant_id,
  });

  const handleSignOut = async () => {
    await signOut();
    toast.success("Logout realizado!");
    navigate("/login");
  };

  const initials = profile?.full_name
    ? profile.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "U";

  const displayName = tenant?.name || profile?.full_name || "CineADS";

  return (
    <header className="h-14 border-b border-border bg-background flex items-center justify-between px-4 md:px-6 shrink-0">
      <div className="flex items-center gap-2">
        {showMenuButton && (
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuToggle} aria-label="Abrir menu">
            <Menu className="h-5 w-5" />
          </Button>
        )}
        {tenantLoading ? (
          <Skeleton className="h-4 w-32" />
        ) : (
          <h2 className="text-sm font-medium text-muted-foreground truncate">
            {displayName}
          </h2>
        )}
      </div>
      <div className="flex items-center gap-1 md:gap-2">
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Alternar tema">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <NotificationsBell />
        <Avatar className="h-8 w-8 hidden md:flex">
          <AvatarFallback className="text-xs bg-primary/10 text-primary">{initials}</AvatarFallback>
        </Avatar>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Sair</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
