# Member card and personal invitation release — September 17, 2026

## Scope and target

Release prepared from membership production commit `21fb0748a671ec230fe331db467df22131da3919`. Target: Vercel `ruined-members`, Git branch `codex/my-ruined-foundation`, and `https://members.theruinedproject.com`. The public website remains on its own production branch. Feature changes were merged in an isolated checkout; newer production header, appearance switch, photo uploader and profile work are preserved.

Edit profile is the sole content editor. Selected public fields feed My Card in the existing worn 3D archive room. My Invitation uses separate, default-off name-sharing consent and a stable personal link. A fresh request can be attributed to the inviting member, bound to verified admitted identity and counted once after completed paid or complimentary joining. The owner sees a private count and operations administrators can inspect the joined member records. No access, admission or payment requirement is bypassed.

The invitation request route brings the existing durable waitlist implementation to the membership project. Recovery remains owned by the public project's existing waitlist worker; this release adds no second scheduled worker. Its existing Sheets integration requires the focused `@vercel/oidc` dependency. No email is sent during deployment or verification.

## Release checks

- Isolated full suite: 1,205 passed; no failures, skips or cancellations.
- Full lint, TypeScript, optimized production build and whitespace checks passed.
- Standalone artwork checks cover member/invitation faces, full-length profile names and safe excerpts. The release preserves the checked artwork and physics.
- Production database identity was checked against the membership project's configured Supabase project. Only the existing matching database credential was used; no full production environment was downloaded.
- Read-only repeatable-read preflight verified all 36 existing migration checksums, prerequisites and the absence of preexisting feature tables or public cards. Only the three intended migrations were pending, with no findings.

Required migrations, in order:

1. `20260917200000_public_member_cards.sql`
2. `20260919210000_member_profile_card_sync.sql`
3. `20260919211000_member_referrals.sql`

The three migrations were applied successfully before application publication. Read-only post-application verification matched all 39 ledger entries and confirmed private table privileges, RLS, default-off sharing, helper functions and all three referral triggers, with no findings. No cards, invitations or referrals existed or were published during verification. The checksum/advisory-lock runner preserved applied history.

## Verification limits

The Browser security-check service denied access to the local preview because it could not verify the admin-enforced policy. No browser workaround was used. Responsive rendering, GPU interaction and authenticated production editing/sharing have not received an automated browser pass. No synthetic production member, invitation, referral, payment or outbound message is created during deployment verification. Build/CI, hosting status and database verification are recorded separately from browser QA.

## Rollback

Previous successful membership deployment: `https://ruined-members-jv0cq6uoz-ruined-s-projects.vercel.app`, GitHub deployment `6513128406`, commit `21fb0748a671ec230fe331db467df22131da3919`. Roll back only the membership application if needed. The additive schema and new referral history should remain; do not drop tables or revert member data. Public `ruined` production and worker ownership remain unchanged.
