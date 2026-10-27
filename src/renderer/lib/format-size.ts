/**
 * Bytes as the catalog writes them: whole units, one decimal below ten.
 *
 * Shared by the index entry's meta line and the detail panel's Size field, so
 * the same repo cannot read `4.1 MB` in one place and `4 MB` in the other.
 */
export function formatSize(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
