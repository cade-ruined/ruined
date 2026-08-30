import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import OperatorMemberRecord from "@/components/platform/OperatorMemberRecord";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import type { OpsMemberRecord } from "@/lib/platform/ops-model";
import { getOpsMemberOperatingRecord } from "@/lib/platform/ops-operating-repository";
import { getOpsMemberProfileSupport } from "@/lib/platform/ops-profile-repository";
import { getOperatorPageContext } from "@/lib/platform/page-data";
import {
  getPreviewOpsMemberProfileSupport,
  getPreviewOpsMemberRecord,
} from "@/lib/platform/ops-preview";

export const metadata: Metadata = { title: "Member record" };
export const dynamic = "force-dynamic";

export default async function OperationsMemberRecordPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") {
    return <PlatformUnavailable reason="operator_access" />;
  }
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;

  if (context.state === "preview") {
    return (
      <OperatorMemberRecord
        profileSupport={getPreviewOpsMemberProfileSupport(memberId)}
        record={getPreviewOpsMemberRecord(memberId)}
      />
    );
  }
  if (!context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;

  let record: OpsMemberRecord | null;
  try {
    record = await getOpsMemberOperatingRecord(context.viewer.authUserId, memberId);
  } catch (error) {
    console.error("Operations member record could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
  if (!record) notFound();
  const profileSupport = record.access.capabilities.includes("member.private_profile.read")
    ? await getOpsMemberProfileSupport(context.viewer.authUserId, memberId).catch((error) => {
        console.error("Operations member profile support could not be loaded", {
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
        return null;
      })
    : null;
  return <OperatorMemberRecord profileSupport={profileSupport} record={record} />;
}
