import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Local review only: never copy a member call into public assets. */
export async function GET(request: Request) {
  const host = new URL(request.url).hostname;
  if (process.env.NODE_ENV === "production" || getPlatformConfiguration().mode !== "preview" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(host)) {
    return new Response(null, { status: 404 });
  }
  const path = process.env.LIBRARY_PREVIEW_VIDEO_PATH;
  if (!path?.endsWith(".mp4")) return new Response(null, { status: 404 });
  let size: number;
  try { size = (await stat(path)).size; } catch { return new Response(null, { status: 404 }); }
  const range = request.headers.get("range");
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  let start = 0;
  let end = size - 1;
  if (range) {
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  const file = createReadStream(path, { start, end });
  const chunks = file[Symbol.asyncIterator]();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (closed) return;
        if (next.done) { closed = true; controller.close(); }
        else controller.enqueue(next.value);
      } catch (error) {
        if (!closed) { closed = true; controller.error(error); }
      }
    },
    cancel() { closed = true; file.destroy(); },
  });
  return new Response(stream, {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}
