# Operations usability review

Date: September 8, 2026. Local implementation; not deployed.

## What was wrong with Circle search

The reported search returned the member, but hid the result inside a second dropdown. Other matching people could be excluded by placement filters, and search did not consistently include the names saved during onboarding.

Search now shows people directly with an Add to Circle action. Assigned or unavailable people remain visible with a reason and a link to their Circle or membership record. Search, clear, and pagination return to the selected Circle's search pane. A person opened from their member profile is labeled separately when outside the current results.

Name search uses saved preferred and display names. Only administrators can additionally search private full names and emails; scoped operators retain their existing visibility. Members in forming Circles no longer appear in the unassigned filter or the Overview count.

## Where each job starts

| Area | Main job | Usability change |
| --- | --- | --- |
| Overview | Choose the next job | Attention items and direct task links |
| People / Members | Find someone and review their setup | Visible search, allowance action, profile, task and note controls |
| People / Circles | Manage a Circle's roster | Direct member results and placement explanations; setup below |
| People / Blocks | Group Circles | Visible create, assign and activate sequence |
| People / Operators | Add or manage an operator | Clear invitation and existing-access states |
| Learning & events / Foundations | Review progress | Existing scoped progress snapshot remains available |
| Learning & events / Experiences | Plan an event and manage people | Search, draft/edit links, roster, attendance and waitlist paths |
| Learning & events / Academy | Manage training | Lessons first, search/filter, visible lesson and collection creation |
| Learning & events / Artifacts | Award and fulfill artifacts | Queue first, visible template, product binding and tracking controls |
| Messages / Support | Answer a member | Topic/status filters, member link and reply shortcut |
| Messages / Announcements | Publish a member update | Visible draft composer and publishing review |
| Messages / Notifications | Send an in-app message | Explicit audience, message review, delivery history and recoverable failures |
| Tasks & tools / Work queue | Complete operational follow-up | Work-type filters and relevant action links |
| Tasks & tools / System | Find integration problems | Attention-first service checks and task links |

Navigation uses visible, wrapping horizontal groups and destinations. Member-side navigation and server authorization rules are unchanged. Everyday actions no longer depend on finding a hidden setup drawer; secondary registration changes and advanced settings remain contextual.

## Verification

- Full suite: 675 tests passed. ESLint, TypeScript, whitespace checks, and the optimized Next.js build passed.
- All main operator destinations and member, event, Academy, and support detail examples checked in local preview at 390×844, 1024×820, and 1440×900; no horizontal overflow. Legacy billing/sync destinations still lead to System.
- Circle search, eligibility, pagination, deep links, response validation, and permission scope tested. SQL search executed against an isolated PostgreSQL-compatible test database, not production.
- Navigation role visibility, action targets, notification review, retry handling, and preview write guards tested.
- Preview forms do not make live mutation requests. No real member was assigned, removed, invited, activated, or given operator access during this pass.

## Still deliberate specialist setup

- Shopify artifact binding still requires the correct Product GID and handle; a Shopify product picker was not added.
- Academy publishing still requires working media/thumbnail/caption URLs; media hosting/upload tooling was not added.
- Live email, calendar, fulfillment, and member-changing actions were not exercised against real recipients. Their existing APIs and permission policies are preserved.
- Production deployment and a new-operator walkthrough remain the next release steps.
