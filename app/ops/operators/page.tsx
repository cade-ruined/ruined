import type { Metadata } from "next";
import { redirect } from "next/navigation";

import OperatorAccessManager from "@/components/platform/OperatorAccessManager";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import {
  getOperatorAccessDirectory,
  type OperatorAccessEntry,
} from "@/lib/platform/ops-access-repository";
import { PREVIEW_OPS_CIRCLES } from "@/lib/platform/ops-preview";
import { getOperatorPageContext } from "@/lib/platform/page-data";
import { getOpsCircleSummaries } from "@/lib/platform/ops-repository";

export const metadata: Metadata = { title: "Operators" };
export const dynamic = "force-dynamic";

const PREVIEW_OPERATORS: OperatorAccessEntry[] = [
  {
    authUserId: "00000000-0000-4000-8000-000000000001",
    circles: [],
    displayName: "Cade Mangelson",
    email: "cade@theruinedproject.com",
    id: "operator:preview-admin",
    invitedAt: null,
    lastSignedInAt: "2026-08-29T15:30:00.000Z",
    role: "ops_admin",
    status: "active",
  },
  {
    authUserId: "00000000-0000-4000-8000-000000000002",
    circles: [{ id: "preview-circle-01", name: "Circle 01" }],
    displayName: "Tyler Bastian",
    email: "tyler@ruined.local",
    id: "operator:preview-shaper",
    invitedAt: null,
    lastSignedInAt: "2026-08-28T19:15:00.000Z",
    role: "circle_leader",
    status: "active",
  },
  {
    authUserId: null,
    circles: [{ id: "preview-circle-02", name: "Circle 02" }],
    displayName: "Jordan Lee",
    email: "jordan@ruined.local",
    id: "invitation:preview-guide",
    invitedAt: "2026-08-28T17:00:00.000Z",
    lastSignedInAt: null,
    role: "guide",
    status: "invited",
  },
];

export default async function OperationsOperatorsPage() {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;
  if (context.role !== "ops_admin") return <PlatformUnavailable reason="operator_access" />;

  const preview = context.state === "preview";
  let operators = preview ? PREVIEW_OPERATORS : null;
  let circles = preview
    ? PREVIEW_OPS_CIRCLES
        .filter((circle) => circle.status === "forming" || circle.status === "active")
        .map((circle) => ({ id: circle.id, name: circle.name }))
    : null;

  if (!preview && context.viewer) {
    try {
      const [directory, circleRows] = await Promise.all([
        getOperatorAccessDirectory(context.viewer.authUserId),
        getOpsCircleSummaries(context.viewer.authUserId),
      ]);
      operators = directory;
      circles = circleRows
        .filter((circle) => circle.status === "forming" || circle.status === "active")
        .map((circle) => ({ id: circle.id, name: circle.name }));
    } catch (error) {
      console.error("Operator access management could not be loaded", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  if (!operators || !circles) return <PlatformUnavailable accessHref="/ops/access" />;

  return (
    <OperatorPageFrame title="Operators">
      <OperatorAccessManager
        circles={circles}
        currentViewerAuthUserId={context.viewer?.authUserId ?? PREVIEW_OPERATORS[0].authUserId}
        initialOperators={operators}
        preview={preview}
      />
    </OperatorPageFrame>
  );
}
