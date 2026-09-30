import postgres from "postgres";
import { getMemberSegmentConfiguration, MemberSegmentSyncError, runMemberSegmentSync } from "../src/lib/communications/member-segment-sync.ts";

const arguments_ = process.argv.slice(2);
if (arguments_.some(value => !["--apply", "--dry-run"].includes(value))
  || (arguments_.includes("--apply") && arguments_.includes("--dry-run"))) {
  console.error("Use --dry-run (default) or --apply. Output contains counts only.");
  process.exitCode = 1;
} else {
  const config = getMemberSegmentConfiguration();
  const apply = arguments_.includes("--apply");
  if (!config.ready || (apply && !config.enabled)) {
    console.log(JSON.stringify({ ready: config.ready, enabled: config.enabled, missing: config.missing,
      ...(apply && !config.enabled ? { required: "RESEND_MEMBER_SEGMENT_SYNC_ENABLED=true" } : {}) }, null, 2));
    process.exitCode = 1;
  } else {
    const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5 });
    try {
      console.log(JSON.stringify(await runMemberSegmentSync(sql, { apply }), null, 2));
    } catch (error) {
      console.error(JSON.stringify({ error: error instanceof MemberSegmentSyncError ? error.code : "member_segment_sync_failed" }));
      process.exitCode = 1;
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
}
