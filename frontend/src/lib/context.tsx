import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, supabase } from "./api";
type AppContextValue = {
  session: Session | null;
  authLoading: boolean;
  me: any;
  meLoading: boolean;
  meError: Error | null;
  workspace: any;
  workspaceId: string;
  setWorkspaceId: (id: string) => void;
  canEdit: boolean;
  isOwner: boolean;
  refresh: () => void;
  toast: (message: string) => void;
};
const AppContext = createContext<AppContextValue>(null!);
export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(!!supabase);
  const [workspaceId, setWorkspace] = useState(
    localStorage.getItem("afterbuy.workspace") || "",
  );
  const [notice, setNotice] = useState("");
  const client = useQueryClient();
  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setAuthLoading(false);
      if (event === "SIGNED_OUT") client.clear();
      if (event === "PASSWORD_RECOVERY") window.location.assign("/auth/reset");
    });
    return () => subscription.unsubscribe();
  }, [client]);
  const me = useQuery({
    queryKey: ["me", session?.user.id],
    queryFn: () => api("/me"),
    enabled: !!session,
    retry: 1,
  });
  const membership =
    me.data?.memberships?.find((m: any) => m.workspace?.id === workspaceId) ??
    me.data?.memberships?.[0];
  const activeId = membership?.workspace?.id || "";
  const setWorkspaceId = (id: string) => {
    setWorkspace(id);
    localStorage.setItem("afterbuy.workspace", id);
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
  };
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 6000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  return (
    <AppContext.Provider
      value={{
        session,
        authLoading,
        me: me.data,
        meLoading: me.isPending,
        meError: me.error,
        workspace: membership?.workspace,
        workspaceId: activeId,
        setWorkspaceId,
        canEdit: membership?.role !== "viewer",
        isOwner: membership?.role === "owner",
        refresh: () => {
          void client.invalidateQueries();
        },
        toast: setNotice,
      }}
    >
      {children}
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      )}
    </AppContext.Provider>
  );
}
export const useApp = () => useContext(AppContext);
export function useWorkspaceQuery<T = any>(
  path: string,
  options: { poll?: number; enabled?: boolean } = {},
) {
  const { workspaceId } = useApp();
  return useQuery<T>({
    queryKey: [workspaceId, path],
    queryFn: () => api(`/workspaces/${workspaceId}${path}`),
    enabled: !!workspaceId && options.enabled !== false,
    refetchInterval: options.poll,
    retry: 1,
  });
}
export function useWorkspaceApi() {
  const { workspaceId } = useApp();
  return <T = any,>(path: string, options?: Parameters<typeof api>[1]) =>
    api<T>(`/workspaces/${workspaceId}${path}`, options);
}
