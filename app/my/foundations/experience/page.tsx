import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function MemberFoundationsExperiencePage() {
  // Preserve old bookmarks; the replacement document enforces member access.
  redirect("/my/foundations/deck");
}
