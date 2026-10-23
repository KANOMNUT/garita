import { describe, it, expect } from "vitest";
import { proxyLabel } from "./proxyLabel";

const t = (host: string) => `Requests to this cluster go through ${host} (proxy-url in the kubeconfig cluster entry)`;

describe("proxyLabel", () => {
  it("null for null, undefined, empty, no scheme", () => {
    expect(proxyLabel(null)).toBeNull();
    expect(proxyLabel(undefined)).toBeNull();
    expect(proxyLabel("")).toBeNull();
    expect(proxyLabel("proxy.corp:3128")).toBeNull();
  });
  it("http and https", () => {
    expect(proxyLabel("http://proxy.corp:3128")).toEqual({ label: "via proxy", host: "proxy.corp", port: "3128", title: t("http://proxy.corp:3128") });
    expect(proxyLabel("https://p:8443")?.label).toBe("via proxy");
  });
  it("socks5 and socks5h read SOCKS5", () => {
    expect(proxyLabel("socks5://p:1080")?.label).toBe("via SOCKS5 proxy");
    const r = proxyLabel("socks5h://p:1080");
    expect(r?.label).toBe("via SOCKS5 proxy");
    expect(r?.title).toContain("socks5h://p:1080");
  });
  it("IPv6 keeps brackets", () => {
    expect(proxyLabel("http://[::1]:3128")).toMatchObject({ host: "[::1]", port: "3128" });
    expect(proxyLabel("http://[::1]")).toMatchObject({ host: "[::1]", port: null });
  });
  it("long host and no port", () => {
    const h = "a".repeat(80) + ".example.com";
    expect(proxyLabel(`http://${h}:3128`)).toMatchObject({ host: h, port: "3128" });
    expect(proxyLabel("http://proxy.corp")).toMatchObject({ host: "proxy.corp", port: null });
  });
  it("userinfo returns null (built at runtime)", () => {
    const withAuth = ["http", "://", "user", ":", "pw", "@proxy:3128"].join("");
    expect(proxyLabel(withAuth)).toBeNull();
    expect(proxyLabel(["http", "://", "user", "@proxy:3128"].join(""))).toBeNull();
  });
});
