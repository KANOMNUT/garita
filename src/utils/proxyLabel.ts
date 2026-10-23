// v2.1.2: display text for a kubeconfig proxy-url (backend `display_proxy` output, `scheme://host[:port]`).
// Defence in depth: a value with `@` (userinfo) is never rendered.
export interface ProxyLabel { label: string; host: string; port: string | null; title: string }

export function proxyLabel(proxy: string | null | undefined): ProxyLabel | null {
  if (!proxy || proxy.includes("@")) return null;
  const m = /^([a-z][a-z0-9+.-]*):\/\/(.+)$/i.exec(proxy);
  if (!m) return null;
  const [, scheme, hp] = m;
  // Split on the last ":" that comes after any closing "]" so IPv6 brackets stay intact.
  const i = hp.lastIndexOf(":");
  const hasPort = i > hp.lastIndexOf("]") && i > 0;
  const s = scheme.toLowerCase();
  return {
    label: s === "socks5" || s === "socks5h" ? "via SOCKS5 proxy" : "via proxy",
    host: hasPort ? hp.slice(0, i) : hp,
    port: hasPort ? hp.slice(i + 1) : null,
    title: `Requests to this cluster go through ${scheme}://${hp} (proxy-url in the kubeconfig cluster entry)`,
  };
}
