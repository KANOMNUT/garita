import { Pause } from "lucide-react";
import { argoHealthPill } from "../utils/argoStatus";

/**
 * The glyph of an ArgoCD status pill (`ArgoPill.icon` from `utils/argoStatus.ts`). It is decoration (the status word
 * sits beside it), so a screen reader skips it. The Suspended glyph `⏸` (U+23F8) can render as a colour emoji in
 * WKWebView, so it is drawn as the Pause icon instead. Shared by the Applications list, the panel header and
 * the Resources tab (filter chips and rows), so a status has one look.
 */
export function ArgoGlyph({ icon }: { icon: string }) {
  return icon === argoHealthPill("Suspended").icon ? <Pause size={10} aria-hidden /> : <span aria-hidden>{icon}</span>;
}
