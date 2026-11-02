import type { Metadata } from "next";
import { redirect } from "next/navigation";

import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import OperatorWorkQueue from "@/components/platform/OperatorWorkQueue";
import { getOpsWorkQueue } from "@/lib/platform/ops-operating-repository";
import { getOperatorPageContext } from "@/lib/platform/page-data";
import { PREVIEW_OPS_WORK_QUEUE } from "@/lib/platform/ops-preview";

export const metadata: Metadata = { title: "Operator work" };
export const dynamic = "force-dynamic";

export default async function OperationsWorkPage({ searchParams }: { searchParams?: Promise<{ view?: string | string[]; filter?: string | string[]; sort?: string | string[] }> }) {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;

  const params = await searchParams;
  const view = params?.view === "dismissed" ? "dismissed" : "active";
  const filters = ["all", "held_email", "task", "artifact", "workflow_failure"] as const;
  const requestedFilter = filters.find(value => value === params?.filter) ?? "all";
  const filter = view === "dismissed" && (requestedFilter === "artifact" || requestedFilter === "workflow_failure") ? "all" : requestedFilter;
  const sort = params?.sort === "oldest" || params?.sort === "newest" ? params.sort : "priority";
  if (context.state === "preview") {
    const items = view === "dismissed" ? [] : PREVIEW_OPS_WORK_QUEUE.items.filter(item => filter === "all" || (filter === "held_email" ? item.kind === "task" && Boolean(item.heldEmail) : item.kind === filter));
    if (sort !== "priority") items.sort((left, right) => {
      if (!left.createdAt && !right.createdAt) return left.workId.localeCompare(right.workId);
      if (!left.createdAt) return 1;
      if (!right.createdAt) return -1;
      return (sort === "oldest" ? left.createdAt.localeCompare(right.createdAt) : right.createdAt.localeCompare(left.createdAt)) || left.workId.localeCompare(right.workId);
    });
    return <OperatorWorkQueue queue={{
      items,
      totals: { artifacts: items.filter(item => item.kind === "artifact").length, failures: items.filter(item => item.kind === "workflow_failure").length, tasks: items.filter(item => item.kind === "task").length, dismissedTasks: 0 },
      view, filter, sort,
    }} preview />;
  }
  if (!context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;

  try {
    const queue = await getOpsWorkQueue(context.viewer.authUserId, { view, filter, sort });
    return <OperatorWorkQueue queue={queue} />;
  } catch (error) {
    console.error("Operations work queue could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
}
