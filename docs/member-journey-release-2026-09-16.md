# Member journey release — September 16, 2026

The approved profile system now covers the member journey: compact mobile Polaroid identity, Paper/Ink materials, four primary destinations, horizontal 3:4 journal covers, restrained red selection accents, chronological Events with optional calendar, and simplified Foundations progress. Journal supports private text, galleries, and video. Timeline keeps its existing persistence and access rules.

## Release scope

Prepared from membership production commit `631d57d79b150e81746ad8d624c2f799371ccf3c` in an isolated checkout. The target is Vercel `ruined-members`, production branch `codex/my-ruined-foundation`, at `https://members.theruinedproject.com`. Public-site production and unrelated operator changes are excluded. The member record data needed by About is included; no entitlement, billing, or member activation changes are made.

## Completed checks

- Full release suite: 1,113 passed, no failures or skips.
- Lint, TypeScript, optimized production build, and diff checks passed.
- Existing 35 migration checksums matched before application. Only `20260916230000_member_journal.sql` was pending; the migration runner now includes it.
- Journal migration applied successfully. Afterwards all 36 release migrations matched, with no pending migrations or checksum drift.
- Both journal tables enforce RLS and deny direct anonymous/authenticated browser-role access.
- Dedicated `member-journal` bucket is private, with a 50 MiB cap and the five intended image/video MIME types.
- Existing server credentials passed signed image and MP4 uploads, signed byte-range reads, and public-read denial. Temporary probe objects were removed.
- Tests cover journal ownership, unauthorized access, bounded media, idempotent saves, saved entries, pagination, and Timeline persistence. Storage probes do not constitute a member sign-in or native-player UI test.

## Verification limits

The browser security-check service continued to deny browser inspection. No rendered responsive or authenticated production browser pass is claimed. The approved local preview remained available to the user. Production deployment/CI completion and live HTTP checks are recorded after the release rather than presumed by this document.
