# Public website release — 9 September 2026

## Release boundary

Prepared from public production `main` (`bd30f6f`), not from the membership branch. This release includes the public Members page, five-room navigation, loading recovery, catalog states, and membership inquiry handoff. It preserves the existing Google keyless registration integration and does not include pending operator, member-platform, database, or CAD work.

## Validation before publication

- A clean dependency installation and `npm run check` passed: lint, TypeScript, **196 public-branch tests**, and a production build. The 834-test result in the earlier walk audit describes the larger membership working tree, not this release.
- Production dependency audit: zero known vulnerabilities. Next/eslint-config-next are pinned to 15.5.24; Sharp is 0.35.4, including Next's image dependency; fflate is patched within its existing compatible range.
- The public Members image and paper assets are included in the release. No source sequence images were regenerated.
- Existing live Shopify catalog showed BYOB Tank at $48. Men's / M selection enabled preorder. No product, inventory, order, or customer bag was changed.
- Production has the Shopify Storefront, checkout-domain, and Resend configuration. Membership links point to the separate members host; inquiries use the existing contact delivery flow.

## Shopify follow-up requiring configuration

The live catalog connection works. Product-change webhooks are not yet configured: production lacks `SHOPIFY_WEBHOOK_SECRET`, and Shopify's webhook list is empty. Saving the signing secret in the public Vercel project and creating create/update/delete hooks at `https://theruinedproject.com/api/revalidate` is awaiting specific approval. Successful homepage catalog reads already revalidate every 60 seconds, and store/product/checkout reads remain current.

Shopify sender authentication also requires DNS changes. The following CNAME names are absent from all four authoritative nameservers; Shopify reports invalid DNS:

| Name under theruinedproject.com | Required target |
| --- | --- |
| `57i._domainkey` | `dkim1.a1f4b3cebabf.p27.email.myshopify.com` |
| `57i2._domainkey` | `dkim2.a1f4b3cebabf.p27.email.myshopify.com` |
| `pdk1._domainkey.maileryfn` | `dkim3.ebc278fb0382.p525.email.myshopify.com` |
| `pdk2._domainkey.maileryfn` | `dkim4.ebc278fb0382.p525.email.myshopify.com` |
| `mailer57i` | `a1f4b3cebabf.p27.email.myshopify.com` |
| `maileryfn` | `ebc278fb0382.p525.email.myshopify.com` |

DMARC is also absent and should be planned separately so existing mail services are not disrupted. No DNS records, mail routing, or credentials were changed during these checks. Shopify's sender fallback does not imply the website's separate Resend contact delivery is broken.

This file records pre-publication checks, not proof of a completed deployment or purchase. Final deployment and live-browser results belong in the task handoff.

## Post-deployment homepage catalog correction

Live checks after release `d568677` found that the Store loaded Shopify's BYOB Tank at $48 and checkout worked, but the optional homepage cache reported an unavailable catalog. Production logs showed its catalog callback failing during background revalidation. The precise production-only cache interaction was not established; the installed Shopify SDK and Next patched fetch worked together in an isolated cache-context reproduction.

The correction removes the separate homepage cache and uses the same fresh catalog read as the Store. This supersedes the 60-second homepage revalidation statement above. Missing configuration, confirmed empty catalogs, provider failures, and the five-second cancellation limit retain their distinct behavior; failures cannot preserve stale prices or block a later successful request. Regression tests exercise the actual homepage adapter, Shopify mapper, and installed SDK with only upstream HTTP mocked. No Shopify data, credentials, or checkout behavior is changed by this correction.
