// Client-generated shell session id. The backend (`resolve_session_id`) accepts 1-64 chars of
// [A-Za-z0-9_-], and Tauri event names allow only alphanumerics, `-`, `/`, `:` and `_`.
// `crypto.randomUUID` is missing on WebKit older than Safari 15.4 (macOS before 12.3), so a
// `getRandomValues` fallback keeps the Shell tab from throwing during render-time effects.

interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => unknown;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const FALLBACK_LENGTH = 32;

export function newSessionId(c: CryptoLike | undefined = globalThis.crypto): string {
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(FALLBACK_LENGTH);
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

const SHELL_PREFIX = "Failed to start shell: ";

/** Backend errors already start with "Failed to start shell: "; do not prepend it twice. */
export function stripShellPrefix(message: string): string {
  return message.startsWith(SHELL_PREFIX) ? message.slice(SHELL_PREFIX.length) : message;
}
