import { useCallback, useEffect, useState } from "react";
import { useKubeContexts, useCurrentContext } from "./useResources";

// Phase 1 de-anchoring (docs/plan-kubeconfig-and-parity.md §1.5–1.6): the app
// no longer rewrites the user's kubeconfig on switch. The "active in app"
// context is ordinary app state — persisted to localStorage, never written to disk.
//
// Resolution order, re-run whenever the enabled context set changes (covers the
// disable/remove-the-active-context case, not just first launch):
//   stored value if present in list_contexts()
//   -> get_current_context() (kubectl default) if present in list_contexts()
//   -> first available
//   -> "" (every hook is already `enabled: !!context`-guarded)
const STORAGE_KEY = "active-context";

export function useActiveContext(): [string, (name: string) => void] {
  const [activeContext, setActiveContextState] = useState("");
  const { data: contexts } = useKubeContexts();
  const { data: kubeconfigDefault, isFetched: defaultFetched } = useCurrentContext();

  const setActiveContext = useCallback((name: string) => {
    setActiveContextState(name);
    try {
      localStorage.setItem(STORAGE_KEY, name);
    } catch {}
  }, []);

  useEffect(() => {
    if (!contexts) return; // wait for the enabled union to be known
    const names = contexts.map((c) => c.name);
    if (activeContext && names.includes(activeContext)) return; // still valid, nothing to do

    let stored = "";
    try {
      stored = localStorage.getItem(STORAGE_KEY) ?? "";
    } catch {}
    if (stored && names.includes(stored)) {
      setActiveContextState(stored);
      return;
    }
    if (kubeconfigDefault && names.includes(kubeconfigDefault)) {
      setActiveContext(kubeconfigDefault);
      return;
    }
    if (!defaultFetched) return; // give get_current_context a chance before falling further
    if (names.length === 0) {
      // Nothing resolvable right now (e.g. a transient empty fetch) — clear
      // the in-memory value so `enabled: !!context` hooks go quiet, but don't
      // overwrite a stored preference that might still be valid once the
      // list recovers.
      setActiveContextState("");
      return;
    }
    setActiveContext(names[0]);
  }, [contexts, kubeconfigDefault, defaultFetched, activeContext, setActiveContext]);

  return [activeContext, setActiveContext];
}
