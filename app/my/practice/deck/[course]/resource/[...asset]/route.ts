import { readFile } from "node:fs/promises";
import path from "node:path";

import { authorizePracticeDeck, practiceDeckHeaders } from "@/lib/practice/deck-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const common = new Set(["shared/base.css", "shared/player.css", "shared/common.js"]);
const foundation = new Set(["app.js", "data.js", "interactions.js", "style.css"]);
const time = new Set(["app.js", "data.js", "monthly-deck.js", "style.css"]);

export async function GET(_request: Request, { params }: { params: Promise<{ course: string; asset: string[] }> }) {
  const { course, asset } = await params;
  const access = await authorizePracticeDeck(course);
  if (!access.allowed) return new Response(null, { status: access.status, headers: practiceDeckHeaders });
  const name = asset.join("/");
  // Only these resources are served. No HTML source, provenance, path traversal,
  // other course data, facilitator notes, or arbitrary disk paths are reachable.
  const isCommon = common.has(name);
  if (access.course === "f1" || !(isCommon || (access.course === "time" ? time : foundation).has(name))) {
    return new Response(null, { status: 404, headers: practiceDeckHeaders });
  }
  const file = path.join(process.cwd(), "src/data/practice-decks", isCommon ? name : `${access.course}/${name}`);
  const content = await readFile(file, "utf8");
  return new Response(content, { headers: { ...practiceDeckHeaders, "Content-Type": name.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8" } });
}
