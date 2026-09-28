import "server-only";
import { getApplicationDatabase } from "@/lib/database/server";
import { getPublicMemberCardScope } from "./public-card-repository";
import { journalStore } from "./journal-storage";
import { JournalError, JOURNAL_UUID, journalFilePolicy, type JournalKind } from "./journal-model";
import { MEMBER_CARD_TOKEN } from "./public-card-model";

/** Explicit visitor projection: no dates from Timeline, saved flags, versions, or owner identity. */
export type PublicJournalEntry = {
  id: string; kind: JournalKind; title: string | null; body: string | null; createdAt: string;
  media: { url: string; mimeType: string }[];
};
export type PublicJournalPage = { entries: PublicJournalEntry[]; hasMore: boolean; nextCursor: string | null };
type EntryRow = { id: string; kind: JournalKind; title: string | null; body: string | null; created_at: Date | string; current_version: number };
type MediaRow = { id: string; entry_id: string; mime_type: string };

export async function getPublicJournal(token: string, cursor: string | null = null): Promise<PublicJournalPage | null> {
  if (!MEMBER_CARD_TOKEN.test(token)) return null;
  if (cursor !== null && !JOURNAL_UUID.test(cursor)) throw new JournalError(400, "Invalid journal page.");
  const scope = await getPublicMemberCardScope(token);
  if (!scope) return null;
  const sql = getApplicationDatabase();
  // Cursor identity is derived solely from this member's current public collection.
  const rows = await sql<EntryRow[]>`
    select id, kind, title, body, created_at, current_version from member_journal_entries
    where member_id = ${scope.memberId}::uuid and visibility = 'public' and deleted_at is null
      and (${cursor === null} or (created_at, id) < (
        select created_at, id from member_journal_entries where id = ${cursor}::uuid
          and member_id = ${scope.memberId}::uuid and visibility = 'public' and deleted_at is null
      ))
    order by created_at desc, id desc limit 31
  `;
  const page = rows.slice(0, 30);
  let media: MediaRow[] = [];
  if (page.length) {
    media = await sql<MediaRow[]>`
      select media.id, media.entry_id, media.mime_type from member_journal_media media
      join member_journal_entries entry on entry.id = media.entry_id and entry.member_id = media.member_id
      where media.member_id = ${scope.memberId}::uuid and entry.id in ${sql(page.map(row => row.id))}
        and entry.visibility = 'public' and entry.deleted_at is null
        and media.state = 'ready' and media.verified_at is not null and media.removed_at is null
      order by media.position, media.id
    `;
    // Withdrawals/content edits during media reads discard the stale projection.
    const current = await sql<{ id: string; current_version: number }[]>`
      select id, current_version from member_journal_entries where member_id = ${scope.memberId}::uuid
        and id in ${sql(page.map(row => row.id))} and visibility = 'public' and deleted_at is null
    `;
    if (page.some(row => !current.some(latest => latest.id === row.id && latest.current_version === row.current_version))) return null;
  }
  const latestScope = await getPublicMemberCardScope(token);
  if (!latestScope || latestScope.memberId !== scope.memberId || latestScope.version !== scope.version) return null;
  return {
    entries: page.map(row => ({
      id: row.id, kind: row.kind, title: row.title, body: row.body, createdAt: new Date(row.created_at).toISOString(),
      media: media.filter(item => item.entry_id === row.id).map(item => ({
        url: `/api/cards/${token}/journal/media/${item.id}`, mimeType: item.mime_type,
      })),
    })),
    hasMore: rows.length > 30, nextCursor: rows.length > 30 ? page.at(-1)!.id : null,
  };
}

type PublicMediaRow = { storage_path: string; mime_type: string; byte_size: number; entry_id: string; current_version: number };
async function publicMedia(memberId: string, id: string): Promise<PublicMediaRow | null> {
  const [row] = await getApplicationDatabase()<PublicMediaRow[]>`
    select media.storage_path, media.mime_type, media.byte_size, media.entry_id, entry.current_version
    from member_journal_media media join member_journal_entries entry
      on entry.id = media.entry_id and entry.member_id = media.member_id
    where media.id = ${id}::uuid and media.member_id = ${memberId}::uuid
      and entry.visibility = 'public' and entry.deleted_at is null
      and media.state = 'ready' and media.verified_at is not null and media.removed_at is null
  `;
  if (!row || !row.storage_path.startsWith(`${memberId}/verified/`)) return null;
  journalFilePolicy(row.mime_type, Number(row.byte_size));
  return row;
}

export async function getPublicJournalMedia(token: string, id: string): Promise<{ data: Blob; mimeType: string } | null> {
  if (!MEMBER_CARD_TOKEN.test(token) || !JOURNAL_UUID.test(id)) return null;
  const scope = await getPublicMemberCardScope(token);
  if (!scope) return null;
  const row = await publicMedia(scope.memberId, id);
  if (!row) return null;
  const { data, error } = await journalStore().download(row.storage_path);
  if (error || !data) throw new JournalError(503, "This media is temporarily unavailable.");
  // Never expose a signed URL: repeat both consent checks after the slow storage read.
  const latestScope = await getPublicMemberCardScope(token);
  if (!latestScope || latestScope.memberId !== scope.memberId || latestScope.version !== scope.version) return null;
  const current = await publicMedia(scope.memberId, id);
  if (!current || current.entry_id !== row.entry_id || current.current_version !== row.current_version
      || current.storage_path !== row.storage_path || current.mime_type !== row.mime_type || current.byte_size !== row.byte_size) return null;
  return { data, mimeType: row.mime_type };
}
