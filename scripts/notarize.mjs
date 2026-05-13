#!/usr/bin/env node
/**
 * notarize.mjs
 *
 * No-op placeholder for Phase 0. Wired up in Phase 5 (Polish & distribution)
 * once we have signing credentials and GitHub Actions release workflow.
 *
 * Future shape (sketch — DO NOT enable in Phase 0):
 *
 *   import { notarize } from '@electron/notarize'
 *
 *   export default async function notarizing(context) {
 *     const { electronPlatformName, appOutDir } = context
 *     if (electronPlatformName !== 'darwin') return
 *
 *     const appName = context.packager.appInfo.productFilename
 *     return notarize({
 *       tool: 'notarytool',
 *       appBundleId: 'com.alltherepos.desktop',
 *       appPath: `${appOutDir}/${appName}.app`,
 *       appleApiKey: process.env.APPLE_API_KEY,
 *       appleApiKeyId: process.env.APPLE_API_KEY_ID,
 *       appleApiIssuer: process.env.APPLE_API_ISSUER,
 *     })
 *   }
 *
 * Phase 0 ships unsigned local DMGs (see electron-builder.yml: identity: null,
 * hardenedRuntime: false). Notarization is intentionally skipped until we have
 * the Developer ID + App Store Connect API key in CI.
 */

export default async function notarize(_context) {
  // Intentional no-op.
  return
}

// Allow direct invocation (`node scripts/notarize.mjs`) for sanity checks.
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('notarize.mjs: Phase 0 no-op. Enable in Phase 5.')
}
