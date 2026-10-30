// Saves text or bytes as a file from the page (CSV exports, the backup, the filled forms).

export function download(name: string, body: string | Uint8Array, type: string): void {
  const blob = new Blob([typeof body === "string" ? body : new Uint8Array(body)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
