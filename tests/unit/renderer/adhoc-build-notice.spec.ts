/**
 * The first-launch explanation appears exactly once, and only where it applies.
 *
 * A downloaded copy of an un-notarised build does not open, so the explanation
 * has to reach two places a person can actually read: `READ-ME-FIRST.txt`
 * inside the DMG, which is the only surface visible before macOS blocks the
 * launch, and this notice, once they are inside the app. The DMG half is
 * packaging configuration; this half is a decision, and both ways it can be
 * wrong are silent — a banner that reappears every launch is one people learn
 * to ignore, and a banner that never appears leaves the launch unexplained.
 *
 * So the rule is a pure function and it is asserted here, rather than left to
 * a render test that would not exist.
 *
 * The settings field is asserted too, for a different reason: this is the first
 * thing added to the settings blob in a while, and `settings.json` files in the
 * wild do not have it. A missing key has to mean `false` — not "invalid file,
 * fall back to defaults", which would silently reset someone's scan roots.
 */

import { describe, expect, test } from "vitest";

import { SettingsSchema } from "@shared/schemas";

import { shouldShowAdHocNotice } from "@renderer/components/layout/adhoc-build-notice";

describe("whether the ad-hoc build notice is shown", () => {
  test("shows on an ad-hoc signed build — the case it exists for", () => {
    expect(
      shouldShowAdHocNotice({ signature: "ad-hoc", dismissed: false }),
    ).toBe(true);
  });

  test("shows on an unsigned build, which macOS blocks for the same reason", () => {
    expect(
      shouldShowAdHocNotice({ signature: "unsigned", dismissed: false }),
    ).toBe(true);
  });

  test("never shows on a notarised build — that is the whole point of notarising", () => {
    expect(
      shouldShowAdHocNotice({ signature: "developer-id", dismissed: false }),
    ).toBe(false);
  });

  test("never shows when the signature is unknown — a development run has nothing to explain", () => {
    // `unknown` is what `probeSigning` reports from source, where the notice
    // would be explaining a Gatekeeper dialog that never happened.
    expect(shouldShowAdHocNotice({ signature: "unknown", dismissed: false })).toBe(
      false,
    );
  });

  test("stays dismissed, whatever the signature", () => {
    expect(shouldShowAdHocNotice({ signature: "ad-hoc", dismissed: true })).toBe(
      false,
    );
    expect(shouldShowAdHocNotice({ signature: "unsigned", dismissed: true })).toBe(
      false,
    );
  });
});

describe("the dismissed flag in the settings blob", () => {
  test("defaults to false, so the notice is shown on a fresh install", () => {
    const parsed = SettingsSchema.parse({
      scanPaths: [],
      ollamaBaseUrl: "http://localhost:11434",
      ollamaEmbedModel: "nomic-embed-text",
      openaiEmbedModel: null,
      defaultEditor: "vscode",
      identities: [],
      schemaVersion: 1,
    });
    expect(parsed.adHocNoticeDismissed).toBe(false);
  });

  test("round-trips true, so dismissing is remembered", () => {
    const parsed = SettingsSchema.parse({
      scanPaths: ["/Users/someone/code"],
      ollamaBaseUrl: "http://localhost:11434",
      ollamaEmbedModel: "nomic-embed-text",
      openaiEmbedModel: null,
      defaultEditor: "vscode",
      identities: [],
      adHocNoticeDismissed: true,
      schemaVersion: 1,
    });
    expect(parsed.adHocNoticeDismissed).toBe(true);
    // The rest of the file survives the new key, which is the point of
    // defaulting it rather than requiring it.
    expect(parsed.scanPaths).toEqual(["/Users/someone/code"]);
  });

  test("a settings file written before the key existed still parses", () => {
    // Nothing to go on but absence: the field must not turn an existing file
    // into a schema failure, or every scan root would be dropped on upgrade.
    const legacy = {
      scanPaths: ["/Users/someone/code", "/Volumes/work"],
      ollamaBaseUrl: "http://localhost:11434",
      ollamaEmbedModel: "nomic-embed-text",
      openaiEmbedModel: null,
      defaultEditor: "cursor",
      defaultTerminal: "iterm2",
      identities: ["someone"],
      schemaVersion: 1,
    };
    const parsed = SettingsSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.scanPaths).toHaveLength(2);
    expect(parsed.success && parsed.data.adHocNoticeDismissed).toBe(false);
  });
});
