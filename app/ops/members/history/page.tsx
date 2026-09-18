import type { Metadata } from "next";
import { redirect } from "next/navigation";

import OperatorHistoricalMemberDirectory, { HistoricalMemberAccessDenied } from "@/components/platform/OperatorHistoricalMemberDirectory";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getHistoricalMemberDirectory, MemberHistoryRepositoryError, type HistoricalMemberDirectoryPage } from "@/lib/platform/member-history-repository";
import { getOperatorAccessContext } from "@/lib/platform/page-data";

export const metadata: Metadata = { title: "Historical members" };
export const dynamic = "force-dynamic";

export default async function HistoricalMembersPage({ searchParams }: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  const context = await getOperatorAccessContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (context.state === "unavailable") return <PlatformUnavailable accessHref="/ops/access" />;
  if (context.role !== "ops_admin") return <OperatorPageFrame title="Historical members"><HistoricalMemberAccessDenied /></OperatorPageFrame>;

  const params = await searchParams;
  const query = Array.isArray(params.q) ? params.q[0] : params.q;
  const page = Number(Array.isArray(params.page) ? params.page[0] : params.page);
  let directory: HistoricalMemberDirectoryPage;
  if (context.state === "preview") {
    directory = { members: [], query: "", page: 1, pageCount: 1, pageSize: 25, totalResults: 0 };
  } else {
    if (!context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;
    try {
      directory = await getHistoricalMemberDirectory(context.viewer.authUserId, { query, page });
    } catch (error) {
      if (error instanceof MemberHistoryRepositoryError && error.status === 403) {
        return <OperatorPageFrame title="Historical members"><HistoricalMemberAccessDenied /></OperatorPageFrame>;
      }
      console.error("Historical member directory could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" });
      return <PlatformUnavailable accessHref="/ops/access" />;
    }
  }
  return <OperatorPageFrame title="Historical members"><OperatorHistoricalMemberDirectory directory={directory} preview={context.state === "preview"} /></OperatorPageFrame>;
}
