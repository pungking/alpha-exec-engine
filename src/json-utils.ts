export function parseJsonText<T>(text: string, context: string): T {
  const safeText = text
    .replace(/:\s*NaN/g, ": null")
    .replace(/:\s*Infinity/g, ": null")
    .replace(/:\s*-Infinity/g, ": null");
  try {
    return JSON.parse(safeText) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${context} JSON parse failed: ${message}`);
  }
}
