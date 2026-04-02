import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ChevronRight, FolderOpen, Leaf } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useMlbCategories } from "@/hooks/useMlbCategories";

export default function MarketplaceCategoriesPage() {
  const { getRoots, getChildren, search } = useMlbCategories();

  const [categories, setCategories] = useState<any[]>([]);
  const [loadingCats, setLoadingCats] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [breadcrumb, setBreadcrumb] = useState<Array<{ id: string; name: string }>>([]);

  // Load roots on mount
  useEffect(() => {
    setLoadingCats(true);
    getRoots().then(setCategories).finally(() => setLoadingCats(false));
  }, []);

  // Load children when breadcrumb changes
  useEffect(() => {
    if (searchQuery.trim()) return;
    if (breadcrumb.length === 0) {
      setLoadingCats(true);
      getRoots().then(setCategories).finally(() => setLoadingCats(false));
    } else {
      setLoadingCats(true);
      getChildren(breadcrumb[breadcrumb.length - 1].id)
        .then(setCategories)
        .finally(() => setLoadingCats(false));
    }
  }, [breadcrumb.length]);

  // Search with debounce
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setLoadingCats(true);
      try {
        const result = await search(searchQuery);
        setSearchResults(result.data || []);
        setSearchTotal(result.total || 0);
      } catch { /* ignore */ }
      setLoadingCats(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const navigateTo = async (id: string, name: string) => {
    setLoadingCats(true);
    setBreadcrumb((prev) => [...prev, { id, name }]);
    try { setCategories(await getChildren(id)); } catch { /* ignore */ }
    setLoadingCats(false);
  };

  const navigateToBreadcrumb = async (index: number) => {
    if (index < 0) {
      setBreadcrumb([]);
      setLoadingCats(true);
      getRoots().then(setCategories).finally(() => setLoadingCats(false));
      return;
    }
    const newCrumb = breadcrumb.slice(0, index + 1);
    setBreadcrumb(newCrumb);
    setLoadingCats(true);
    getChildren(newCrumb[index].id).then(setCategories).finally(() => setLoadingCats(false));
  };

  const displayItems = searchQuery.trim() ? searchResults : categories;

  return (
    <div className="space-y-4">
      <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
        <h1 className="text-2xl font-bold tracking-tight">Categorias do Mercado Livre</h1>
        <p className="text-sm text-muted-foreground">
          Navegue pela árvore oficial de categorias do MLB
        </p>
      </motion.div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar categoria por nome..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Breadcrumb */}
      {!searchQuery.trim() && breadcrumb.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap text-sm">
          <button onClick={() => navigateToBreadcrumb(-1)} className="text-primary hover:underline font-medium">
            MLB
          </button>
          {breadcrumb.map((item, idx) => (
            <span key={item.id} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              {idx === breadcrumb.length - 1 ? (
                <span className="text-foreground font-medium">{item.name}</span>
              ) : (
                <button onClick={() => navigateToBreadcrumb(idx)} className="text-primary hover:underline">
                  {item.name}
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {searchQuery.trim() && searchTotal > 0 && (
        <p className="text-xs text-muted-foreground">{searchTotal} resultados encontrados</p>
      )}

      {/* Category list */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {loadingCats ? (
          <div className="p-4 space-y-2">
            {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : displayItems.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {searchQuery
              ? `Nenhuma categoria encontrada para "${searchQuery}"`
              : "Nenhuma categoria disponível. Verifique a conexão com o Mercado Livre."}
          </div>
        ) : (
          displayItems.map((cat) => (
            <button
              key={cat.id}
              onClick={() => { if (!cat.is_leaf && !searchQuery.trim()) navigateTo(cat.id, cat.name); }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 text-left text-sm border-b border-border last:border-b-0 transition-colors",
                !cat.is_leaf && !searchQuery.trim() ? "hover:bg-muted/50 cursor-pointer" : "cursor-default"
              )}
            >
              {cat.is_leaf
                ? <Leaf className="h-4 w-4 text-green-500 shrink-0" />
                : <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium">{cat.name}</p>
                {searchQuery.trim() && cat.path_from_root && (
                  <p className="text-xs text-muted-foreground truncate">
                    {(cat.path_from_root as Array<{ name: string }>).map((p) => p.name).join(" > ")}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">{cat.id}</p>
              </div>
              {cat.is_leaf ? (
                <Badge variant="outline" className="text-green-600 border-green-600/30 text-xs shrink-0">Folha</Badge>
              ) : (
                !searchQuery.trim() && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
