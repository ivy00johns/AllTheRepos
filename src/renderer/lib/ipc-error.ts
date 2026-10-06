/**
 * The part of an IPC rejection worth showing a human.
 *
 * `ipcRenderer.invoke` rejects with whatever the main process threw,
 * wrapped in `Error invoking remote method '<channel>': Error: `. The
 * channel name is noise to someone reading a dialog — the sentence the
 * main process wrote is the whole message.
 */
export function ipcErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
    "",
  );
}
