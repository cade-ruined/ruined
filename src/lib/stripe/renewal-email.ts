import type { RenewalInvoicePreview } from "./renewal-policy";

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** Persist the whole message before sending; provider retries reuse identical text. */
export function createMembershipRenewalEmail(preview: RenewalInvoicePreview, siteUrl: URL) {
  const amount = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: preview.currency }).format(value / 100);
  const date = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(preview.renewalDate));
  const accountUrl = new URL("/my/account", siteUrl).href;
  const initialTermEnd = preview.noticeKind === "initial_term_end";
  const lines = [
    ...(initialTermEnd ? [
      `Your initial 12-month Ruined membership commitment ends on ${date} UTC.`,
      `Unless you stop renewal, your membership continues month to month at ${amount(preview.membershipAmount)} ${preview.currency.toUpperCase()} per month, plus applicable tax. No new 12-month minimum begins.`,
      "You can stop renewal for the end of your initial commitment from My Ruined → Account. Your accepted first-year payments remain due until that date; requesting an earlier exit uses the cancellation terms you accepted.",
      `The amounts below preview your next monthly invoice on ${new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(preview.previewBillingDate!))}. They are an estimate of ongoing monthly billing, not an invoice for the full next year.`,
    ] : [
      `Your annual Ruined membership renews on ${date} UTC.`,
      `Annual membership: ${amount(preview.membershipAmount)} ${preview.currency.toUpperCase()}`,
    ]),
    `Tax in the current renewal preview: ${amount(preview.taxAmount)}`,
    `Invoice total after applicable discounts: ${amount(preview.invoiceTotal)}`,
    `Expected automatic payment after account balances: ${amount(preview.amountDue)}`,
    "These amounts come from Stripe’s current invoice preview. Changes to tax, billing details, or account credits can change the final invoice.",
    `Review billing and cancellation options in My Ruined → Account: ${accountUrl}`,
    "The membership agreement you accepted governs your commitment, cancellation, and refund terms.",
    "For billing help or to request cancellation by email, contact connect@theruinedproject.com.",
    "This is an essential membership billing notice. It does not change your marketing preferences.",
  ];
  return {
    subject: `${initialTermEnd ? "Your first year of Ruined membership ends" : "Your annual Ruined membership renewal"} · ${new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(preview.renewalDate))}`,
    text: lines.join("\n\n"),
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#E5E0D5;color:#2A2A2A;font-family:Arial,Helvetica,sans-serif"><main style="max-width:560px;margin:0 auto;padding:40px 24px"><p style="font-size:12px;letter-spacing:2px;text-transform:uppercase">Ruined / Membership</p><h1 style="font-family:Georgia,serif;font-size:32px;font-weight:400;line-height:1.2">${initialTermEnd ? "Your first year is ending" : "Your annual renewal"}</h1>${lines.map(line => `<p style="font-size:15px;line-height:1.6">${escapeHtml(line)}</p>`).join("")}<p><a href="${escapeHtml(accountUrl)}" style="display:inline-block;background:#2A2A2A;color:#E5E0D5;padding:16px 22px;text-decoration:none">Manage billing or cancel →</a></p></main></body></html>`,
  };
}
