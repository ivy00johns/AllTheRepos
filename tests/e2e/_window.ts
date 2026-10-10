/**
 * Window size and page measurement, shared by the Electron specs.
 *
 * Two of them need the app's real window at a specific size and then need to
 * ask the page what it did with it: the accessibility spec wants a width below
 * `lg`, and the viewport-fit spec wants the size the 2026-10-07 review measured
 * at. Both questions are about the rendered result, so `resizeWindow` polls the
 * width the page itself reports rather than assuming `setSize` has been laid
 * out by the next line — the window server accepted the request, which is not
 * the same as the renderer having answered it.
 */

import { expect, type ElectronApplication, type Page } from "@playwright/test";

export interface WindowSize {
  width: number;
  height: number;
}

export async function resizeWindow(
  app: ElectronApplication,
  win: Page,
  size: WindowSize,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, next) => {
    const [target] = BrowserWindow.getAllWindows();
    if (!target) throw new Error("no BrowserWindow to resize");
    target.setSize(next.width, next.height);
  }, size);

  await expect
    .poll(() => win.evaluate(() => window.innerWidth), { timeout: 10_000 })
    .toBeLessThanOrEqual(size.width);
}

/**
 * What the page thinks its own size is.
 *
 * `documentScrollHeight` against `innerHeight` is the measurement the review
 * used, so keeping it identical keeps this spec comparable with the finding it
 * guards. `main` is the shell every route renders inside, whose bottom edge
 * cannot pass the viewport without the page scrolling.
 */
export interface PageMetrics {
  innerWidth: number;
  innerHeight: number;
  documentScrollHeight: number;
  bodyScrollHeight: number;
  mainBottom: number;
  mainHeight: number;
  shellBottom: number | null;
}

export async function pageMetrics(win: Page): Promise<PageMetrics> {
  return win.evaluate(() => {
    const main = document.querySelector("main");
    const rect = main?.getBoundingClientRect();
    const shell = main?.firstElementChild;
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      bodyScrollHeight: document.body.scrollHeight,
      mainBottom: rect ? Math.round(rect.bottom) : -1,
      mainHeight: rect ? Math.round(rect.height) : -1,
      shellBottom: shell
        ? Math.round(shell.getBoundingClientRect().bottom)
        : null,
    };
  });
}

/** One line naming every number, for the failure message of a size assertion. */
export function describeMetrics(
  route: string,
  metrics: PageMetrics,
): string {
  return (
    `${route}: document ${metrics.documentScrollHeight}px tall, body ${metrics.bodyScrollHeight}px, ` +
    `window ${metrics.innerWidth}x${metrics.innerHeight}, main bottom ${metrics.mainBottom} ` +
    `(height ${metrics.mainHeight}), shell bottom ${metrics.shellBottom}`
  );
}
