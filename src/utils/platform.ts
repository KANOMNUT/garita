/**
 * True for a macOS user agent. One test for "is this macOS?" in the app: `updateMode` (in-app install on
 * macOS only) and the YAML find shortcut (Cmd+F on macOS, Ctrl+F elsewhere) both call it.
 */
export function isMacUserAgent(userAgent: string): boolean {
  return /macintosh|mac os x/i.test(userAgent);
}
