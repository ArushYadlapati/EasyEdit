// Hands a file to the browser as a download. Call it inside a click: a download started by code long after one can
// be blocked or prompted.
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000); // the browser has taken the file long before
}
