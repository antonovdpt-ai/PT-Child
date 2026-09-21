export const MAX_PROMPT_CHARS = 60_000;
export const MAX_FILES = 5;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_OCR_CHARS = 70_000;

export function normalizeStoragePaths(files: unknown, userId: string): string[] {
  if (!Array.isArray(files)) throw new Error("files must be an array");
  if (files.length > MAX_FILES) throw new Error(`At most ${MAX_FILES} files are allowed`);

  const paths = files.map((file) => {
    if (!file || typeof file !== "object") throw new Error("Invalid file descriptor");
    const path = (file as Record<string, unknown>).storage_path;
    if (typeof path !== "string" || !path.startsWith(`${userId}/`) || path.includes("..")) {
      throw new Error("Invalid storage path");
    }
    return path;
  });

  if (new Set(paths).size !== paths.length) throw new Error("Duplicate storage path");
  return paths;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function extractOcrText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const root = payload as Record<string, any>;
  const result = root.result ?? root;
  const annotation = result?.textAnnotation ?? result?.text_annotation;
  const direct = annotation?.fullText ?? annotation?.full_text;
  if (typeof direct === "string") return direct.trim();

  const lines: string[] = [];
  for (const block of annotation?.blocks ?? []) {
    for (const line of block?.lines ?? []) {
      if (typeof line?.text === "string") {
        lines.push(line.text);
        continue;
      }
      const alternative = Array.isArray(line?.alternatives)
        ? line.alternatives[0]
        : undefined;
      if (typeof alternative?.text === "string") {
        lines.push(alternative.text);
      }
    }
  }
  return lines.join("\n").trim();
}

export function parseJsonLines(text: string): unknown[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}

export function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const root = payload as Record<string, any>;
  if (typeof root.output_text === "string") return root.output_text.trim();
  if (!Array.isArray(root.output)) return "";
  return root.output
    .filter((item: any) => item?.type === "message")
    .flatMap((item: any) => Array.isArray(item.content) ? item.content : [])
    .filter((item: any) => item?.type === "output_text" && typeof item.text === "string")
    .map((item: any) => item.text)
    .join("\n")
    .trim();
}

export function allowedOrigin(origin: string | null, configured: string): string | null {
  if (!origin) return configured.split(",")[0]?.trim() || null;
  const allowed = configured.split(",").map((value) => value.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}
