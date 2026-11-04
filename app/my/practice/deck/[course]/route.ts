import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";

import { authorizePracticeDeck, practiceDeckHeaders } from "@/lib/practice/deck-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ course: string }> }) {
  const { course } = await params;
  const access = await authorizePracticeDeck(course);
  if (!access.allowed) {
    if (access.status === 401) redirect("/my/access");
    if (access.status === 403) redirect("/my/practice");
    return new Response(null, { status: access.status, headers: practiceDeckHeaders });
  }
  // Keep the approved Foundations 01 document and its independent gates intact.
  if (access.course === "f1") redirect("/my/foundations/deck");
  const source = await readFile(path.join(process.cwd(), "src/data/practice-decks", access.course, "index.html"), "utf8");
  const key = `ruined-practice-deck-v1-${access.course}-${createHash("sha256").update(access.ownerId ?? "preview").digest("hex").slice(0, 24)}`;
  const html = source
    .replace("<head>", `<head><base href="/my/practice/deck/${access.course}/resource/">`)
    .replace(/<body\b/, `<body data-resume-key="${key}"`);
  return new Response(html, { headers: { ...practiceDeckHeaders, "Content-Type": "text/html; charset=utf-8" } });
}
