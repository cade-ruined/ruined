# Membership tax setup — September 28, 2026

The owner also confirmed Ruined is a Utah-registered LLC. This establishes the
reported business-entity registration; it does not resolve the separate Sales and
Use Tax license verification described below.

**Decision status:** No final tax classification has been assigned. The current
offer does not support treating the entire membership as automatically nontaxable.
This note records research and setup decisions still needed; it is not a tax ruling.

## Offer and account facts

- The paid offer bundles guided Foundations, a Shaper-led Circle, Academy access,
  and a personal journal/member space. The owner's revised prices are individual
  $499 monthly / $4,990 annually, first-50 founding individual $349 monthly / $3,490
  annually, and couples $699 monthly / $6,990 annually. Annual prices are paid
  upfront; monthly payments carry an initial 12-month commitment. The draft treats
  it as an initial-only minimum, the working interpretation communicated to the owner.
- **Resolved by the owner:** launch is U.S.-only and applicable tax is added to the
  listed prices. This determines geography and exclusive-tax presentation, not
  which supplies are taxable or where Ruined is authorized or required to collect.
- Academy supports articles, audio, downloads, links, PDFs and video. Supported
  formats do not prove which resources will actually be included at paid launch.
- The journal stores member text, images and video and exports personal timeline
  artwork. Its role as an independent product benefit versus a tool incidental to
  human services matters to classification.
- Experiences disclose their own availability, access and separate costs. The
  public offer does not promise blanket free event admission, garments or artifacts.
  Any included goods, admission or discount benefits must be considered if added.
- The live Stripe read on September 28 found Tax status `active`, a Utah origin,
  default product tax code `txcd_99999999`, and **zero Tax registrations**. These
  settings do not establish whether Ruined already holds a state tax permit outside
  Stripe. An active Tax setup is not evidence of authority to collect everywhere.
- **Owner clarification in this task:** Shopify collects tax only in Utah. When
  asked specifically about an issued Utah sales-tax permit separate from the EIN,
  the owner answered, "I only have the EIN / I'm not sure." The supplied Shopify
  U.S. tax-settings overview does not verify an issued state license.
- An EIN identifies the business for federal tax purposes; it is not a state
  sales-tax permit. **Utah permit status remains unverified**, not confirmed absent.
  The Utah-only Shopify setting is a lead for checking an existing account and
  license; it does not establish the registration or its effective date.
  [IRS explanation of an EIN](https://www.irs.gov/businesses/employer-identification-number).

## Current Utah rule that changes the analysis

Utah's 2026 S.B. 162, effective July 1, 2026, adds sales and use tax on access to
digital audiovisual works, audio works, books and gaming services, including
streaming/subscription access regardless of delivery method. It also expressly
addresses seller-hosted prewritten software. See the amendments to
§59-12-103(1)(o)–(p), enrolled page 54, and the effective date on page 92.
[Official enrolled S.B. 162](https://le.utah.gov/Session/2026/bills/enrolled/SB0162.pdf).

**Do not rely on the old streaming-only exemption.** Utah's older membership ruling
17-003 distinguished community access and live education from downloadable content
and independent software, but its streaming-only conclusion predates S.B. 162.
Its mixed-membership analysis is useful context: benefits can be distinct even
when sold for one price. It does not classify Ruined's current bundle.
[Utah PLR 17-003](https://files.tax.utah.gov/tax/commission/ruling/17-003.pdf).

Utah PLR 19-003 found the specific prerecorded-course/software subscription before
it taxable and expressly cautioned that different amounts of personal instruction
could change another course's analysis. Calling a product educational does not
resolve its tax treatment. [Utah PLR 19-003](https://files.tax.utah.gov/tax/commission/ruling/19-003.pdf).

Utah's current software publication also identifies charges for remotely accessed
prewritten software used in Utah as taxable. Merely operating a website is not,
by itself, a determination that the entire membership is a SaaS sale.
[Utah Publication 64](https://tax.utah.gov/forms-pubs/pub-64/).

## Stripe classifications: verified names, unresolved selection

These identifiers and category names appear in official Stripe documentation.
They are **candidates for the corresponding actual supplies**, not an approved
classification of the whole membership.

| Code | Documented category | Relevance |
| --- | --- | --- |
| `txcd_20060044` | Training | Consider only for the actual instructional service; do not use to erase independent digital/software benefits. |
| `txcd_10402200` | Digital Audio Visual Works — streamed — subscription — with conditional rights | Potentially relevant to a paid video library whose access ends with the subscription. |
| `txcd_10103000` | Software as a Service (SaaS) — Personal Use | Potentially relevant to independent hosted journal/member software sold for personal use. |
| `txcd_99999999` | General — Physical Goods | Current account default; not a justified fallback for this mixed membership. |

Sources: [Stripe in-person/performance-location tax guide](https://docs.stripe.com/tax/optional-tax-location/integration-guide)
(Training and Physical Goods), [Stripe digital-product guide](https://docs.stripe.com/tax/digital-products)
(SaaS), and [Stripe documented digital-code eligibility](https://docs.stripe.com/payments/managed-payments/changelog)
(streamed audiovisual subscription code).

Stripe says to match the actual delivery, access and customer type; its generic
electronically supplied services code is not recommended for US digital sales.
Validate the final exact code against the [current tax-code catalog](https://docs.stripe.com/tax/tax-codes)
or Tax Codes API before writing it. Do not select a nontaxable override solely
because the offer is called a membership or education.

## Remaining inputs and next actions

1. **Verify the Utah license before adding a Stripe registration.** Check the legal
   entity's existing Utah Taxpayer Access Point (TAP) business account and prior
   license emails or store records for an issued Sales and Use Tax license and its
   effective date. Do not create a duplicate account merely because the owner is
   unsure. If no existing license is found, the next step is to apply through TAP's
   **Apply for tax account(s) – TC-69**, selecting Sales and Use Tax. Utah says the
   tax-license information is sent by email. **Do not add the Utah registration in
   Stripe until an issued state license and its effective date have been verified.**
   [Utah Sales and Use Tax FAQ](https://tax.utah.gov/business/sales-tax/sales-use-tax-faq/);
   [Utah tax information for businesses](https://tax.utah.gov/business/create-manage/tax-info-business/).
   Adding a registration record to Stripe and registering with the authority are
   separate actions. Stripe's registration service for US remote sellers requires
   no physical presence in the requested state, so it is not an assumed Utah
   registration route for this Utah-based business.
   [Stripe registration guidance](https://docs.stripe.com/tax/registering);
   [Stripe remote-seller registration eligibility](https://docs.stripe.com/tax/use-stripe-to-register).
2. **Implement the confirmed U.S.-only, tax-added offer.** Apply exclusive-tax price
   behavior consistently to all six prices, disclosures, consent and the agreement.
   Collect the supported customer address information needed for sourcing, enforce
   the U.S. launch boundary, and assess collection obligations in the admitted
   states. U.S.-wide availability does not authorize tax collection in every state.
3. **Finalize classification using the actual launch benefits.** Record the live
   instruction delivered, paid Academy resources actually available, independent
   journal benefits, and any included physical/admission/discount rights. Have the
   mixed offer assessed under current Utah law and applicable customer-location
   rules. If allocating taxable and nontaxable components, use a supported method
   and records; do not invent an allocation or silently split the advertised offer.
4. **Configure the membership products explicitly.** Once classification and permit
   evidence are resolved, set the verified product code(s), confirmed exclusive-tax
   price behavior and applicable Stripe registrations with correct effective dates.
   Do not silently change the account-wide physical-goods default used by unrelated
   products. Enable membership automatic tax only against this resolved setup.
5. **Resolve the early termination treatment separately.** The proposed $1,500 fee
   and its possible cap are not final. Once its function and calculation are settled,
   determine whether it represents prepaid remaining service, a contract release
   payment or another supply before assigning tax treatment. Do not automatically
   reuse the membership code or assume a nontaxable penalty.
6. **Verify before real charges.** Exercise the monthly and annual price variants
   for admitted locations; inspect subtotal, tax, total and renewal consent. Check a supported
   zero-tax outcome as well as a taxable outcome, subscription renewal, refund tax
   adjustment and the actual totals used in renewal notices. Preserve evidence and
   confirm collection and filing responsibilities.

No tax-account changes, registration submissions, outside messages or final
classification were made as part of this research.
