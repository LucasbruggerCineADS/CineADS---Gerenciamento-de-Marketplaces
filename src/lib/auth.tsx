import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: { id: string; full_name: string; email: string; tenant_id: string; status?: string } | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthContextType["profile"]>(null);
  const [loading, setLoading] = useState(true);
  const initializedRef = useRef(false);

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      // Ensure we have a valid session token before querying
      const { data: { session: freshSession } } = await supabase.auth.getSession();
      if (!freshSession) {
        console.warn("fetchProfile: no active session, skipping");
        return null;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, tenant_id, status")
        .eq("id", userId)
        .maybeSingle();
      if (error) {
        console.error("Error fetching profile:", error.message);
        return null;
      }
      if (!data) {
        console.warn("fetchProfile: profile not found for user", userId);
        return null;
      }
      // Update last_seen_at
      supabase.from("profiles").update({ last_seen_at: new Date().toISOString() } as any).eq("id", userId).then();
      return data;
    } catch (err) {
      console.error("Unexpected error fetching profile:", err);
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const timeout = setTimeout(() => {
      if (mounted && loading) {
        console.warn("Auth loading timeout - forcing loading to false");
        setLoading(false);
      }
    }, 5000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (!mounted) return;
        
        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (newSession?.user) {
          setTimeout(async () => {
            if (!mounted) return;
            const profileData = await fetchProfile(newSession.user.id);
            if (mounted) {
              setProfile(profileData);
              setLoading(false);
            }
          }, 0);
        } else {
          setProfile(null);
          setLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(async ({ data: { session: currentSession } }) => {
      if (!mounted || initializedRef.current) return;
      initializedRef.current = true;

      setSession(currentSession);
      setUser(currentSession?.user ?? null);

      if (currentSession?.user) {
        const profileData = await fetchProfile(currentSession.user.id);
        if (mounted) setProfile(profileData);
      }
      if (mounted) setLoading(false);
    }).catch(() => {
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
