import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";

import { isFoundationsAvailableToMember } from "@/lib/foundations/availability";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_IDENTITY } from "@/lib/membership/preview";
import { getMemberIdentity } from "@/lib/membership/repository";
import { isMyRuinedVisible } from "@/lib/platform/visibility";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "text/html; charset=utf-8",
  "X-Robots-Tag": "noindex, nofollow",
  Vary: "Cookie",
};

export async function GET() {
  // A document route does not pass through the member React layout.
  if (!isMyRuinedVisible()) return new Response(null, { status: 404, headers });
  const context = await getMembershipPageContext(PREVIEW_MEMBER_IDENTITY, getMemberIdentity, "Foundations");
  if (context.state === "signed_out") redirect("/my/access");
  if (!context.data || !["authenticated", "preview"].includes(context.state)) redirect("/my/foundations");
  const ownerId = context.state === "authenticated" ? context.viewer?.authUserId : null;
  if (!await isFoundationsAvailableToMember(ownerId)) redirect("/my/foundations");
  if (!memberCan(deriveMemberAccessPolicy(context.data), "foundations.write")) redirect("/my/foundations");
  if (context.state === "authenticated" && !ownerId) redirect("/my/access");

  // Slide resume is separate from the four-session completion record and stores
  // no answers. Hash the owner identifier before exposing the browser-only key.
  const resumeKey = `ruined-foundations01-v29-${createHash("sha256").update(ownerId ?? "preview").digest("hex").slice(0, 24)}`;
  const source = await readFile(path.join(process.cwd(), "src/data/foundations-deck/index.html"), "utf8");
  const html = source
    .replace("<head>", '<head><base href="/membership/foundations/deck-v29/">')
    .replace("</head>", '<link rel="stylesheet" href="member.css"></head>')
    .replace("<body>", `<body data-member-resume-key="${resumeKey}"><script src="member.js"></script>`)
    .replace('href="#stage"', 'href="/my/foundations/deck#stage"');

  return new Response(html, { headers });
}
