import { NextResponse } from "next/server";

import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  agreementReceiptSha256,
  renderAgreementReceiptForVersion,
} from "@/lib/membership/agreement-receipt";
import {
  getAgreementReceiptDownload,
  MembershipAccessDeniedError,
} from "@/lib/membership/repository";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  if (getPlatformConfiguration().mode !== "connected") {
    return NextResponse.json({ error: "Agreement receipts are not connected." }, { status: 503 });
  }
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ error: "Passwordless member access is required." }, { status: 401 });
  }

  try {
    const download = await getAgreementReceiptDownload(viewer.authUserId);
    if (!download) {
      return NextResponse.json({ error: "An agreement receipt is not ready yet." }, { status: 404 });
    }
    if (download.receipt.deliveryMethod === "database_snapshot") {
      const receiptText = renderAgreementReceiptForVersion(download.receipt.generatorVersion, {
        acceptanceId: download.acceptance.id,
        acceptedAt: download.acceptance.acceptedAt,
        affirmativeAction: download.acceptance.affirmativeAction,
        agreementBody: download.acceptance.agreementBody,
        agreementContentSha256: download.acceptance.agreementContentSha256,
        agreementKey: download.acceptance.agreementKey,
        agreementTitle: download.acceptance.agreementTitle,
        agreementVersion: download.acceptance.agreementVersion,
        signerEmail: download.acceptance.signerEmail,
        signerName: download.acceptance.signerName,
      });
      const renderedByteSize = Buffer.byteLength(receiptText, "utf8");
      const renderedSha256 = agreementReceiptSha256(receiptText);
      if (
        renderedByteSize !== download.receipt.byteSize ||
        renderedSha256 !== download.receipt.contentSha256
      ) {
        console.error("Agreement receipt integrity validation failed", {
          acceptanceId: download.acceptance.id,
          receiptId: download.receipt.id,
        });
        return NextResponse.json(
          { error: "The agreement receipt failed its integrity check." },
          { status: 502 },
        );
      }
      return new NextResponse(receiptText, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": 'attachment; filename="ruined-membership-agreement.txt"',
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (!download.receipt.storageBucket || !download.receipt.storagePath) {
      return NextResponse.json({ error: "The agreement receipt is incomplete." }, { status: 502 });
    }
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Agreement receipt storage is unavailable." }, { status: 503 });
    }
    const { data, error } = await supabase.storage
      .from(download.receipt.storageBucket)
      .createSignedUrl(download.receipt.storagePath, 60, {
        download: "ruined-membership-agreement",
      });
    if (error || !data.signedUrl) {
      return NextResponse.json({ error: "The agreement receipt could not be opened." }, { status: 502 });
    }
    return NextResponse.redirect(data.signedUrl, 303);
  } catch (error) {
    if (error instanceof MembershipAccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Agreement receipt could not be opened", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "The agreement receipt could not be opened." }, { status: 500 });
  }
}
