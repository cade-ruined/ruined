# Storefront analytics

Use Shopify to assess the purchase funnel and Vercel to investigate the storefront interactions around it. Collect a baseline before changing the frontend in response to these reports. Instrumentation and passing tests establish what the code sends; dashboard receipt and purchase attribution require separate live evidence.

## Where to look

| Report | Use it for | Reading rules |
| --- | --- | --- |
| [Vercel Web Analytics](https://vercel.com/ruined-s-projects/ruined/analytics) | Public storefront pageviews, landing pages, referrers, device/browser differences, and custom UI event counts. | Use the same date range and device filters when comparing pages or events. Check that Web Analytics and custom-event reporting are enabled for the project and supported by its plan. |
| [Shopify Analytics](https://admin.shopify.com/store/theruinedproject/analytics) | Native sessions, sessions with cart additions, checkout progress, completed purchases, and sales. This is the purchase/conversion source of truth. | Filter to the **Headless** sales channel or storefront where that report exposes the dimension. If a report includes other channels, record that scope rather than treating it as this site's funnel. Match date range, timezone, and device filters before comparing reports. |

Shopify's available reports and dimensions can differ. Use its native session-based conversion definitions; consult the [Shopify behavior report definitions](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/behaviour-reports) for the selected report. A Shopify order is stronger purchase evidence than a browser checkout event. Vercel [custom events](https://vercel.com/docs/analytics/custom-events) diagnose actions, and require an eligible Vercel plan.

Do not divide raw Vercel event totals to claim a conversion rate. One visitor can select several sizes, add multiple items, reopen a product, or retry checkout. Vercel and Shopify also have different deduplication, session, consent, and delivery rules. A decline from one event count to another is a question to investigate, not a measured abandonment rate.

## What is measured

Collection is restricted to HTTPS on `theruinedproject.com` and `www.theruinedproject.com`: `/`, `/store`, `/store/<product-handle>`, and `/bag`. Membership, profile, invitation, authentication, operator, and other routes are excluded. Preview and local hosts do not collect these production events.

The central event definitions live in `src/lib/analytics/storefront.ts`. Vercel receives at most two allowlisted properties per event. `product` is the catalogue handle; `source` is a fixed surface label. No member identifiers, contact details, search/form text, raw checkout URLs, cart capability keys, query strings, or URL fragments are event properties.

| Vercel event | Trigger and interpretation | Properties |
| --- | --- | --- |
| `store_catalog_viewed` | The current catalog selection is rendered with its matching style count, including zero results. Consent becoming ready can report the current view, never earlier selections. | `selection`, `results` |
| `store_filter_changed` | A category, collection, or fit changes, or active filters are cleared. Selecting the current value is excluded. | `filter`, `results` |
| `store_color_selected` | A different catalog color is deliberately selected on a product card, product page, or quick-buy panel. Defaults and unchanged selections are excluded. | `product`, `color` |
| `store_catalog_product_selected` | A catalog product link is selected, with its current filter combination. Companion to the existing product selection event; do not add the two counts together. | `product`, `selection` |
| `store_browse_stage` | A permitted catalog product selection progresses to an opened product, successful local bag addition, or checkout attempt/result during the same document lifetime. See attribution limits below. | `selection`, `stage` |
| `store_product_selected` | Product link selected in the store gallery. This is navigation intent. | `product`, `source` |
| `store_product_opened` | Product detail or the homepage quick-buy product becomes eligible to report its view. | `product`, `source` |
| `store_size_guide_opened` | Product size guide opened. Repeated openings can repeat the action. | `product`, `source` |
| `store_variant_selected` | A catalogue option changes, such as size or color; selecting its current value is a no-op. | `product`, `option` |
| `store_add_to_bag` | A product addition is successfully persisted in the local bag. This does not by itself confirm a Shopify cart mutation. | `product`, `source` |
| `store_bag_viewed` | Hydrated bag view is reported after consent permits it. | `quantity`, `value` |
| `store_bag_quantity_changed` | Quantity changes within the supported 1–20 range. No-op clicks are excluded. | `product`, `source` |
| `store_bag_item_removed` | Item removed, including each item in a clear-bag action. | `product`, `source` |
| `store_checkout_clicked` | An eligible, nonempty bag begins checkout. | `quantity`, `value` |
| `store_checkout_redirected` | A checkout URL was returned and browser navigation was requested without a synchronous error. It does not prove the checkout loaded or payment completed. | `quantity`, `value` |
| `store_checkout_failed` | Checkout preparation or the navigation call failed. | `quantity`, `reason` |
| `store_cart_sync_failed` | A consenting visitor’s background bag synchronization failed. Cancelled or stale requests are excluded. | `reason` |
| `store_scroll_depth` | The page crosses 25%, 50%, 75%, or 100% of its scrollable height, once per milestone per route effect. Very short pages are omitted. | `percent` |

Bag and checkout `value` describe the current merchandise total, not revenue or a final tax/shipping-inclusive order total. Currency is not an additional Vercel property under the two-property limit; confirm store currency and avoid combining unlike currency contexts.

Shopify receives native `PAGE_VIEW_2`, `PRODUCT_VIEW`, and `ADD_TO_CART` through its SDK with Shopify-issued visit/unique tokens. `ADD_TO_CART` is sent only after the server confirms a real cart and verifies its final contents. The same cart is reconciled for hosted checkout, allowing Shopify to connect the journey. The server stores the full cart ID in a host-only HttpOnly cookie for three days; analytics receives the keyless cart ID. This identity is operational and checkout still works when analytics is declined. Checkout and completed-purchase reporting belong to Shopify's hosted flow; the application does not fabricate purchase events.

## Categories, collections, fit, and discovery progress

Use `store_filter_changed` to see which controls shoppers deliberately use. Its `filter` label is one of `category:<value>`, `collection:<handle>`, `fit:<value>`, or `reset:all`; `results` is the resulting number of styles, not the number of color cards. Filter those events to `results = 0` to find combinations that lead to an empty catalog. `store_catalog_viewed` provides the full combination and also captures direct links and back/forward navigation, so its counts are different from deliberate control changes.

The `selection` label always uses the same order, for example `category=hoodies|collection=sunday-clothes|fit=unisex`. Empty selections use `all`. Categories and fits come from fixed public choices; collection handles must be registered from the live public catalog before events are accepted. The event boundary rejects unknown collections, malformed labels, arbitrary query values, invalid counts, and free-form color text containing unsupported characters. Raw browser query strings and campaign parameters are never copied into these events.

Fit is a product classification, not an inference about a visitor's gender. Use it to understand demand for available garment cuts. `store_color_selected` shows active color exploration across cards, detail pages, and quick-buy. The two-property limit means that event groups by product and color without a surface or visitor identifier. Existing `store_variant_selected` also records the option change; these are separate views of the same interaction and must not be summed. Color selection does not imply a cart addition or color-specific sale. Use Shopify variant sales to assess actual purchased colors.

`store_browse_stage.stage` has six values:

1. `product_selected`: a catalog link was intentionally selected.
2. `product_opened`: that product's detail view was reported.
3. `add_to_bag`: an addition from that product page was successfully persisted locally.
4. `checkout_clicked`: an eligible bag containing an attributed variant began checkout.
5. `checkout_redirected`: checkout navigation was requested without a synchronous error.
6. `checkout_failed`: checkout preparation or the navigation call failed.

The application keeps only the most recent permitted catalog selection for each selected product in memory. When an attributed product-page addition succeeds, its variant keeps that addition's selection. Checkout stages look up the actual bag's product and variant pairs and emit once per distinct matching selection; merely viewing another product cannot relabel an existing bag item. A quick-buy addition cannot inherit an earlier catalog/product-page context, and removing a bag item removes its context. Context expires after 30 minutes, is capped at 50 products and 50 added variants, and is cleared when consent is pending/withdrawn, GPC blocks analytics, or navigation enters a private route. No context is saved in cookies, local storage, session storage, or a user identifier.

This intentionally measures a partial, consented path. Reloads, new tabs, leaving and returning in a new document, expired context, and previously saved bags can still produce normal Shopify/Vercel commerce events without a filter-attributed browse stage. A bag with several discovery selections can emit several checkout-stage events; repeated actions also repeat counts. Compare these patterns to locate likely friction, but do not calculate session conversion or abandonment rates from raw stage totals. No completed-order attribution to a category, collection, or fit is claimed. Shopify remains the source of truth for completed purchases.

For review, use one date range and device filter, then compare:

- **Discovery use:** category/collection/fit selections and zero-result combinations.
- **Product interest:** product clicks grouped by `selection`, and deliberate color choices grouped by product.
- **Possible friction:** `product_selected` versus `product_opened`, then `add_to_bag` and checkout stages for the same selection, alongside counts and the attribution limits above.
- **Confirmed commerce:** Shopify sessions, cart/checkout progress, completed orders, and variant sales. Do not treat a browser redirect as a purchase.

## Why counts can differ or be missing

These reports represent the measurable, consenting subset of traffic. Unknown, pending, declined, or revoked analytics consent prevents sending. GPC also blocks collection. Shopify analytics additionally requires its privacy API and valid tracking tokens to be ready. Browser blockers, network failures, interrupted navigation, and provider processing delay can reduce receipt.

Vercel drops a hit when the document referrer contains a query/fragment or identifies a private Ruined route/host. Shopify receives a sanitized origin-only referrer. Query-based campaign attribution therefore will not mirror a raw-URL analytics integration.

No pre-launch or pre-consent action history is backfilled. Once a visitor allows analytics, the current eligible page/product/bag can be reported as its present view; earlier actions are not replayed. Staff and QA sessions that consent on the production storefront can count. Record test windows and exclude them when reviewing the baseline where the reporting interface permits it. No individual identity is attached to help subtract a particular staff member later.

## Reading checkout failures

| `reason` | Meaning | First investigation |
| --- | --- | --- |
| `network` | The checkout request did not yield an HTTP response, or an earlier awaited operation threw. | Connectivity, browser errors, request cancellation, and endpoint reachability. |
| `checkout_unavailable` | `/api/store/checkout` returned a non-success HTTP status. | Inspect status and sanitized server diagnostics. It can be invalid/unavailable merchandise, stale catalogue state, validation failure, or an upstream Shopify failure; it is not automatically a Shopify outage. |
| `invalid_response` | A successful HTTP response could not be parsed or lacked a checkout URL. | Response contract, intermediary responses, and release mismatches. |
| `redirect_failed` | URL preparation or the synchronous navigation call threw. | URL handling and browser restrictions. A later checkout page load failure is outside this event's proof. |

`store_cart_sync_failed` diagnoses a failed background bag sync separately: `invalid_bag` means the server rejected the snapshot with HTTP 400 (including unavailable merchandise); `unavailable` means another non-success response or an invalid cart response; `network` means a transport failure or timeout. The event contains no response body or raw error text and is suppressed after consent withdrawal, cancellation, or a generation change. It does not emit `store_checkout_failed` by itself. The local bag stays saved and checkout independently reconciles it. Shopify mutation warnings, partial failures, and final snapshot mismatches return no successful cart result; a later request can reconcile committed changes. Avoid logging upstream payloads, full cart IDs/cookies, checkout URLs, or buyer information during diagnosis.

## Baseline and review routine

1. Record the actual production enablement time, release commit, report timezone, test windows, and any campaign or catalogue changes. Root release evidence belongs below after it is verified.
2. Collect at least one complete weekly cycle before a design conclusion; use longer windows when volume is low. Review the underlying session/event counts alongside percentages. Correct real checkout failures promptly rather than waiting for a baseline.
3. Start with Shopify's native sessions → cart → checkout → purchase funnel in the appropriate channel. Compare mobile and desktop using the same window and filters.
4. Use Vercel to investigate the relevant stage. On mobile, prioritize product access from the homepage/store, option selection, size-guide use, bag visibility, and checkout failures. On desktop, examine product discovery, detail-page engagement, option selection, and bag-to-checkout behavior. Scroll depth helps locate engagement but does not prove that someone read or understood a section.
5. Reproduce the suspected friction on the affected device before editing UI. Make one focused change, record its release time, and compare equivalent traffic and merchandising periods afterward. Campaign mix, inventory, product launches, pricing, consent rates, and small samples can explain a change without a UI effect.

## Safe QA and maintenance

- Run the cart, Shopify analytics, consent, catalog-filter, storefront-interaction, and central analytics tests, plus typecheck/build, after changing the event contract or cart flow. Use mocks or a test store for failure and concurrency scenarios.
- Exercise category/collection/fit changes, reset, zero results, back/forward navigation, color changes, and no-op selections. Confirm only public labels and counts are sent. Check a mixed bag so checkout attribution follows actual added variants rather than the last viewed product.
- In a clean browser, verify that unknown/declined consent and GPC produce no storefront measurement requests. Allow analytics and verify eligible page/product events, then revoke it and confirm later actions stop reporting.
- Verify `/my`, `/profile`, `/invite`, `/auth`, `/ops`, and non-store pages remain excluded. Inspect request metadata without copying secrets or personal data into logs/screenshots.
- Test mobile and desktop: choose a valid variant, add once, change quantity, remove, and open the bag. Check one confirmed native Shopify add per successful added action, cart reuse at checkout, and no `?key=` in analytics payloads. Record any deliberate production cart/test traffic.
- Verify hosted checkout opens and retains the correct items and consent choices. Stop before payment. **Do not place a real order or submit a real purchase until explicitly authorized.** A sandbox order can verify purchase instrumentation without charging a customer, when a suitable test environment is configured.
- Verify dashboard receipt separately. A successful network call or passing fixture does not prove a reported native conversion. Recheck supported Vercel plan, usage limits, SDK updates, report filters, and consent behavior during maintenance.

Set `STOREFRONT_ANALYTICS_ENABLED=false` in the relevant deployment environment and redeploy to roll back this collection. Confirm the new production deployment and reload the test browser: an already-loaded page can retain its old configuration until navigation/reload. This flag disables the Vercel/storefront Shopify bridge; it does not disable normal shopping/checkout or independently configured Meta tracking. `META_TRACKING_ENABLED` remains a separate control. Do not enable the legacy `NEXT_PUBLIC_ANALYTICS_ENDPOINT` as a substitute; it is outside this storefront consent boundary.

## Release evidence

Pre-release verification on October 15, 2026:

- Local browser: selected Staple Hoodie / M, reached hosted Shopify checkout, returned to the bag, changed quantity, and confirmed the same checkout was reused. No order was placed and no contact or payment details were submitted.
- Actual Shopify upstream through the local consent proxy: HTTP 200, valid opaque consent response, all four official token timing fields (`_y`, `_s`, `_ye`, `_se`), and no GraphQL errors. Token/cookie values were not logged.
- The official privacy SDK was exercised with its own token lookup path to confirm reload continuity, denial protection, and expiry refresh.

Production deployment and dashboard receipt are recorded separately after release. Purchase attribution has not been tested with a completed order.
