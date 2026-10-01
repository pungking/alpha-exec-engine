// Critical state must not normalize invalid JSON or expose its contents in errors.
export function parseStrictJsonText<T>(text: string, errorCode: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(errorCode);
  }
}

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
