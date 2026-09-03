# Membership hosting

The membership app uses a separate Vercel project, not a separate repository.

| Application | Vercel project | Production branch | Domain |
| --- | --- | --- | --- |
| Public website | `ruined` | `main` | `theruinedproject.com` |
| Members and operators | `ruined-members` | `codex/my-ruined-foundation` | `members.theruinedproject.com` |

This is the deployment contract for the membership project. Confirm the live
project and domain mapping during release; this document does not provision them.
Do not promote the membership branch in the public project or change the apex
and `www` mappings. Keep Standard Protection on both projects: their production
domains are public, while previews remain protected. Ruined still requires its
own sign-in and server-side permissions for private member and operator data.

## Production configuration

Use the existing membership database, Supabase project, and integration settings
in `ruined-members`' production environment. Set
`NEXT_PUBLIC_SITE_URL=https://members.theruinedproject.com` and retain
`NEXT_PUBLIC_MY_RUINED_ENABLED=true`. Do not change payment mode, prices, or
webhook destinations as part of a hosting move.

Apply these three worker overrides only to the membership project:

```text
RESEND_MARKETING_ENABLED=false
GOOGLE_REGISTRATION_SHEET_ENABLED=false
SUPPORT_EMAIL_ENABLED=true
```

Retain the configured Resend key and sender for transactional support emails,
and a nonempty `CRON_SECRET` for private scheduled endpoints. Store secrets only
in the hosting environment. Google Calendar has separate `GOOGLE_CALENDAR_*`
settings; the registration-Sheets override must not disable Calendar.

## Scheduled-work ownership

| Work | Owner | Daily schedule (UTC) |
| --- | --- | --- |
| Marketing confirmation and contact-sync outbox | Public project | 12:00 |
| BYOB registration Google Sheets sync and reconciliation | Public project | 12:15 |
| Support email retries | Membership project | 12:00 |
| Membership workflows | Membership project | 12:30 |

The membership branch's `vercel.json` schedules only communications and
membership processing. Its communications endpoint runs support independently;
the disabled marketing worker returns without claiming public outbox events.
The original `main` schedule remains unchanged. Do not schedule Sheets from both
projects: its full reconciliation rewrites the shared spreadsheet.

These daily schedules are recovery passes, not a promise of prompt retries.
Normal member actions also trigger immediate bounded processing. Support
deliveries that exceed their safe retry window require operator review.

## Release checks

1. Build the approved membership commit in `ruined-members`, with production
   branch tracking set to `codex/my-ruined-foundation` and the configuration above.
2. Verify the expected commit, successful deployment, and exactly two membership
   cron schedules. Verify the public project's deployment and cron ownership are
   unchanged; do not manually run a worker merely to test authentication.
3. Move only `members.theruinedproject.com` to the new project's production
   deployment. Confirm its required DNS target and HTTPS certificate.
4. Confirm anonymous `/access` loads without Vercel sign-in and `/ops/operators`,
   `/my`, and support pages still enforce Ruined access. Share `/access` as the
   sign-in entry point; the root route retains the public site experience.
5. Confirm Supabase allows `https://members.theruinedproject.com/my/confirmed`,
   email links use the members domain, and a permitted operator can sign in and
   access Operators. Test a new external invitation with an approved recipient.
6. Check `theruinedproject.com` and `www.theruinedproject.com` still use the public
   production deployment, with `www` redirecting to the apex. Check that private
   API requests without authentication remain denied.

## Rollback

Record the previous membership production deployment and its configuration
before each release. Roll back only `ruined-members` to that verified deployment;
retain the members production domain and worker overrides. Recheck login,
permissions, cron ownership, and the unaffected public site. A code rollback
does not roll back database migrations: never reverse them automatically.

On the first release there may be no earlier membership production deployment.
Do not move the public domains or disable project-wide protection to compensate;
keep access closed until the membership deployment can be corrected.
