import { describe, expect, it } from "vitest";
import { isTrustedRendererUrl } from "@main/security/renderer-url";

const bundle = "file:///app/out/renderer/index.html";
describe("trusted renderer URLs", () => {
  it("accepts the exact packaged document with route hashes", () => {
    expect(isTrustedRendererUrl(`${bundle}#/settings`, undefined, bundle)).toBe(true);
  });
  it.each(["file:///tmp/evil.html", "file:///app/out/renderer/index.html.evil", "file://host/app/out/renderer/index.html", "https://evil.test/", "not a url"])("refuses an unrelated document: %s", (url) => {
    expect(isTrustedRendererUrl(url, undefined, bundle)).toBe(false);
  });
  it("accepts only the configured development origin", () => {
    const dev = "http://127.0.0.1:5189";
    expect(isTrustedRendererUrl(`${dev}/#/graph`, dev, bundle)).toBe(true);
    expect(isTrustedRendererUrl("http://127.0.0.1:5190/", dev, bundle)).toBe(false);
    expect(isTrustedRendererUrl("http://127.0.0.1.evil.test:5189/", dev, bundle)).toBe(false);
    expect(isTrustedRendererUrl("http://user:pass@127.0.0.1:5189/", dev, bundle)).toBe(false);
  });
});
