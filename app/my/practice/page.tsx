import type { Metadata } from "next";
import { redirect } from "next/navigation";

import MemberAccessNotice from "@/components/membership/MemberAccessNotice";
import MemberPractice from "@/components/membership/MemberPractice";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_IDENTITY } from "@/lib/membership/preview";
import { getMemberIdentity } from "@/lib/membership/repository";
import { PRACTICE_COURSES, previewPracticeSnapshot, type PracticeCourse } from "@/lib/practice/model";
import { getMemberPracticeSnapshot } from "@/lib/practice/repository";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "The Work | Ruined", description: "Foundations and monthly assignments. One step at a time." };

export default async function MyPracticePage({ searchParams }: {
  searchParams: Promise<{ area?: string; course?: string }>;
}) {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_IDENTITY, getMemberIdentity, "The Work");
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  const access = deriveMemberAccessPolicy(context.data);
  if (!memberCan(access, "foundations.write") && !memberCan(access, "foundations.revisit")) return <MemberAccessNotice access={access} />;

  const query = await searchParams;
  const initialCourse = PRACTICE_COURSES.includes(query.course as PracticeCourse) ? query.course as PracticeCourse : undefined;
  const initialArea = query.area === "monthly" || initialCourse === "time" ? "monthly" : "foundations";
  if (context.state === "preview") return <MemberPractice key="practice-preview" initial={previewPracticeSnapshot()} connected={false} initialArea={initialArea} initialCourse={initialCourse} />;
  if (!context.viewer) return <PlatformUnavailable accessHref="/my/access" />;

  try {
    const initial = await getMemberPracticeSnapshot(context.viewer.authUserId);
    return <MemberPractice key={initial.ownerId} initial={initial} connected initialArea={initialArea} initialCourse={initialCourse} />;
  } catch (error) {
    console.error("Member Practice could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return <section className="member-journey-page">
      <h1 className="member-page-title">The Work couldn’t load.</h1>
      <p>Your saved work is still yours. Please try again.</p>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a className="member-button" href="/my/practice">Try again</a>
    </section>;
  }
}
