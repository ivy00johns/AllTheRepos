import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The emitted main bundle and renderer are siblings in out/. */
export const BUNDLED_RENDERER_URL = pathToFileURL(
  resolve(__dirname, "../renderer/index.html"),
).href;

export function isTrustedRendererUrl(
  raw: string,
  rendererUrl: string | undefined = process.env.ELECTRON_RENDERER_URL,
  bundledUrl: string = BUNDLED_RENDERER_URL,
): boolean {
  try {
    const target = new URL(raw);
    if (target.username || target.password) return false;
    if (rendererUrl) {
      const dev = new URL(rendererUrl);
      if ((dev.protocol === "http:" || dev.protocol === "https:") && target.origin === dev.origin) return true;
    }
    const bundle = new URL(bundledUrl);
    return target.protocol === "file:" && target.hostname === bundle.hostname && target.pathname === bundle.pathname;
  } catch {
    return false;
  }
}
