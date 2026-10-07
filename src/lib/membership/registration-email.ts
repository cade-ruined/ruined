import type { RegistrationFoundingPricing } from "./registration-model";
import { registrationFoundingConfirmation } from "./registration-pricing-confirmation";
import { registrationPaidConfirmation, type RegistrationPaidMembership } from "./registration-paid-confirmation";

export type RegistrationMessageKind = "welcome" | "profile_ready";
export type RegistrationCompletionBasis = "saved_card" | "complimentary" | "paid_membership";

export type RegistrationEmailInput = {
  kind: RegistrationMessageKind;
  memberName: string;
  completionBasis: RegistrationCompletionBasis;
  siteUrl: URL;
  /** Inline image frozen with the message; never a recipient-specific public URL. */
  invitationImageSrc?: string;
  foundingPricing?: RegistrationFoundingPricing | null;
  paidMembership?: RegistrationPaidMembership | null;
};

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const welcomeParagraphs: Array<{ text: string; bold?: boolean; emphasis?: string; call?: boolean; handwritten?: boolean }> = [
  { text: "First, thank you.", handwritten: true },
  { text: "Not just for registering, but for trusting us enough to be part of what we’re building from the beginning." },
  { text: "RU/NED was never created because we thought people needed another course, another networking group, or another place to collect information." },
  { text: "There’s plenty of information." },
  { text: "What’s harder to find is a room full of people who are actually doing something with it. People building, changing, starting over, figuring things out, asking better questions, sharing what they know, and willing to help someone else do the same." },
  { text: "That’s what we’re trying to build here. And now you’re part of it.", bold: true },
  { text: "So, here’s what happens next." },
  { text: "Every RU/NED Membership begins with Foundations. It gives all of us a shared starting point before we move into everything Membership becomes from there.", emphasis: "Foundations" },
  { text: "Your first Foundations call is November 5 at 3:00PM MT.", bold: true, call: true },
  { text: "Between now and then, you don’t need to figure anything out on your own. We’ll be in touch with everything you need to know, including onboarding, access, reminders, and details for your first call." },
  { text: "For now, keep an eye on your inbox. We’ll take it from here." },
  { text: "We have a lot we want to build with RU/NED. We know where we’re going. And some of what we build along the way will exist because of the people who walk through the door and help shape it.", emphasis: "We know where we’re going. And some of what we build along the way will exist because of the people who walk through the door and help shape it." },
  { text: "You’re one of those people now.", bold: true },
  { text: "We’re really glad you’re here." },
  { text: "See you November 5." },
];

// Gmail iOS recolors live text but preserves the ink image. These two layers
// restore white text there; other clients retain the inline bone color. Scope
// black layer backgrounds to Gmail CSS, and never wrap artwork or pricing.
// https://www.hteumeuleu.com/2021/fixing-gmail-dark-mode-css-blend-modes/
function welcomeText(html: string, color = "#e9e4d9") {
  return `<div class="gmail-blend-screen"><div class="gmail-blend-difference" style="color:${color}">${html}</div></div>`;
}

function welcomeBodyHtml(thankYouImage: string, paragraphs = welcomeParagraphs) {
  return paragraphs.map(paragraph => {
    let content = escapeHtml(paragraph.text);
    if (paragraph.handwritten) return `<p style="margin:0 0 22px;color:#ffca2c"><img src="${escapeHtml(thankYouImage)}" width="250" alt="${content}" style="display:block;width:250px;max-width:100%;height:auto;border:0;color:#ffca2c;font-size:24px"></p>`;
    if (paragraph.bold) content = `<strong>${content}</strong>`;
    else if (paragraph.emphasis) content = content.replace(escapeHtml(paragraph.emphasis), `<strong>${escapeHtml(paragraph.emphasis)}</strong>`);
    if (paragraph.call) return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#a83329" style="margin:32px 0;background:#a83329;background-image:linear-gradient(#a83329,#a83329)"><tr><td style="padding:24px;color:#fff9ec">${welcomeText(`<p style="margin:0;font-size:22px;line-height:1.4">${content}</p>`, "#fff9ec")}</td></tr></table>`;
    return welcomeText(`<p style="margin:0 0 22px;font-size:16px;line-height:1.75">${content}</p>`);
  }).join("\n");
}

/** Pure rendering: the worker stores this exact HTML/text before any provider call. */
export function createRegistrationEmail(input: RegistrationEmailInput) {
  const welcome = input.kind === "welcome";
  const paid = welcome && input.completionBasis === "paid_membership"
    ? registrationPaidConfirmation(input.paidMembership) : null;
  if (welcome && input.completionBasis === "paid_membership" && !paid) {
    throw new Error("paid_registration_receipt_unavailable");
  }
  const paragraphs = paid ? welcomeParagraphs.map(paragraph => paragraph.call
    ? { ...paragraph, text: `Your first Foundations call is ${paid.firstCall}.` }
    : paragraph.text === "See you November 5." ? { ...paragraph, text: `See you ${paid.firstCallDay}.` } : paragraph) : welcomeParagraphs;
  const founding = welcome && input.completionBasis === "saved_card"
    ? registrationFoundingConfirmation(input.foundingPricing) : null;
  const name = input.memberName.trim() || "Friend";
  const title = welcome ? "Welcome to RU/NED" : "Your profile is ready.";
  const subject = welcome ? "Welcome to RU/NED" : "Your Ruined profile is ready";
  const eyebrow = welcome ? null : "Make it yours";
  const preheader = welcome
    ? paid ? `${paid.amount}. Your first Foundations call is ${paid.firstCall}.`
      : "Your first Foundations call is November 5 at 3:00PM MT. We’re really glad you’re here."
    : "Your profile is open. Your next chapter is yours to build.";
  const greeting = welcome
    ? `${name}, you’re in.`
    : `${name}, your Ruined profile is now open.`;
  const next = "Add your photo, tell a little of your story, and make this space your own.";
  const charge = input.completionBasis === "paid_membership" ||
    (!welcome && input.completionBasis === "saved_card" && Boolean(input.paidMembership))
    ? "Opening your profile does not authorize a new charge. Your membership billing follows the terms you already accepted; review Membership billing for its current status."
    : input.completionBasis === "saved_card"
    ? "Paid membership begins only after you review the price and terms and explicitly confirm activation. Saving a card or opening your profile does not authorize future charges."
    : "Opening your profile does not start paid billing. Any future paid membership requires your review and explicit confirmation.";
  const action = welcome ? "View your registration" : "Open your profile";
  const actionUrl = new URL(welcome ? "/my/registered" : "/my", input.siteUrl).toString();
  const billingUrl = new URL("/my/activate", input.siteUrl).toString();
  const agreementUrl = paid ? new URL(paid.agreementPath, input.siteUrl).toString() : null;
  const imageUrl = welcome && input.invitationImageSrc
    ? input.invitationImageSrc
    : new URL("/membership/card/share/invitation-spin-v1.jpg", input.siteUrl).toString();
  const imageAlt = welcome && input.invitationImageSrc
    ? "Your original Ruined invitation card in the basement room."
    : "A Ruined invitation card in the basement room.";
  const logo = new URL(welcome ? "/ruined-wordmark-email-bone.png" : "/ruined-wordmark-email.png", input.siteUrl).toString();
  // Rendered from the actual CadeHandy2 font so email apps do not substitute it.
  const thankYouImage = new URL("/membership/email/first-thank-you-cadehandy2.png", input.siteUrl).toString();
  const signoffImage = new URL("/membership/email/after-the-fear-cadehandy2.png", input.siteUrl).toString();
  const inkTexture = new URL("/membership/design/printers-ink.jpg", input.siteUrl).toString();
  // The HTML background attribute supports email clients that strip background
  // CSS; the ink color stays readable when a client blocks images entirely.
  const textureAttribute = welcome ? ` background="${escapeHtml(inkTexture)}"` : "";
  const textureStyle = welcome ? `;background-image:url('${escapeHtml(inkTexture)}'),linear-gradient(#10100f,#10100f);background-position:center top;background-size:600px auto;background-repeat:repeat` : "";
  const theme = welcome
    ? { outer: "#080807", paper: "#10100f", ink: "#e9e4d9", muted: "#9b978d", rule: "#36352f" }
    : { outer: "#d6d1c7", paper: "#e9e5da", ink: "#23231f", muted: "#666259", rule: "#cbc6b9" };
  const footer = "This is an update about your Ruined registration, not a newsletter subscription.";
  const paymentSummary = paid ? [paid.heading, paid.amount, paid.paidOn, paid.paymentDetail, paid.coverage, paid.nextCharge,
    ...(paid.responsibility ? [paid.responsibility] : []), paid.profile] : [];
  const paymentTerms = paid ? [paid.commitment, paid.renewal, paid.cancellation, paid.earlyExit,
    ...(paid.founding ? [paid.founding] : [])] : [];
  const text = (welcome
    ? [greeting, "", ...paymentSummary.flatMap(paragraph => [paragraph, ""]),
      ...(founding ? [founding.heading, founding.monthly, founding.annual, founding.scope, "", founding.retention, "", founding.payment, ""] : []), ...paragraphs.flatMap(paragraph => [paragraph.text, ""]),
      ...(paid ? ["Your Foundations dates", "Four live virtual sessions, 90 minutes each.", ...paid.calls, "", ...paymentTerms.flatMap(paragraph => [paragraph, ""]),
        `Membership billing: ${billingUrl}`, `Your accepted agreement: ${agreementUrl}`, ""] : []),
      "Tyler, Libby, Cade & Mitch", "RU/NED", "After the fear", "", "Need a hand? connect@theruinedproject.com", footer]
    : [title, "", greeting, "", next, "", charge, "", `${action}: ${actionUrl}`, "", "After the fear.", "", "Need a hand? connect@theruinedproject.com", footer]
  ).join("\n");

  const foundingHtml = founding ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffca2c" style="margin:8px 0 32px;background:#ffca2c;color:#23231f"><tr><td style="padding:24px;color:#23231f"><h3 style="margin:0 0 14px;font-size:20px;line-height:1.3">${escapeHtml(founding.heading)}</h3><p style="margin:0 0 10px;font-size:36px;font-weight:700;line-height:1.2;letter-spacing:-1px">${escapeHtml(founding.monthly)}</p><p style="margin:0 0 8px;font-size:14px;line-height:1.5">${escapeHtml(founding.annual)}</p><p style="margin:0;font-size:12px;line-height:1.5">${escapeHtml(founding.scope)}</p><p style="margin:20px 0 12px;font-size:14px;line-height:1.6">${escapeHtml(founding.retention)}</p><p style="margin:0;font-size:14px;line-height:1.6;font-weight:700">${escapeHtml(founding.payment)}</p></td></tr></table>` : "";
  const paidHtml = paid ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffca2c" style="margin:8px 0 32px;background:#ffca2c;color:#23231f"><tr><td style="padding:24px;color:#23231f"><h3 style="margin:0 0 14px;font-size:20px;line-height:1.3">${escapeHtml(paid.heading)}</h3><p style="margin:0 0 16px;font-size:36px;font-weight:700;line-height:1.2;letter-spacing:-1px">${escapeHtml(paid.amount)}</p>${paymentSummary.slice(2).map(paragraph => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6">${escapeHtml(paragraph)}</p>`).join("")}</td></tr></table>` : "";
  const paidTermsHtml = paid ? welcomeText(`<h3 style="margin:36px 0 14px;font-size:22px;line-height:1.3">Your Foundations dates</h3><p style="margin:0 0 14px;font-size:14px;line-height:1.6">Four live virtual sessions, 90 minutes each.</p>${paid.calls.map(call => `<p style="margin:0 0 8px;font-size:14px;line-height:1.6">${escapeHtml(call)}</p>`).join("")}<h3 style="margin:32px 0 14px;font-size:22px;line-height:1.3">Your membership terms</h3>${paymentTerms.map(paragraph => `<p style="margin:0 0 16px;font-size:14px;line-height:1.7">${escapeHtml(paragraph)}</p>`).join("")}<p style="margin:24px 0 0;font-size:15px;line-height:1.8"><a href="${escapeHtml(billingUrl)}" style="color:#e9e4d9;text-decoration:underline;font-weight:700">Membership billing</a><br><a href="${escapeHtml(agreementUrl!)}" style="color:#e9e4d9;text-decoration:underline">Your accepted agreement</a></p>`) : "";
  const body = welcome
    ? `${paidHtml}${foundingHtml}${welcomeBodyHtml(thankYouImage, paragraphs)}${paidTermsHtml}${welcomeText('<p style="margin:32px 0 20px;font-size:16px;line-height:1.75"><strong>Tyler, Libby, Cade &amp; Mitch</strong></p>')}<img src="${escapeHtml(logo)}" width="130" height="39" alt="RU/NED" style="display:block;width:130px;height:39px;border:0"><p style="margin:14px 0 0;color:#ffca2c"><img src="${escapeHtml(signoffImage)}" width="220" alt="After the fear" style="display:block;width:220px;max-width:100%;height:auto;border:0;color:#ffca2c;font-size:24px"></p>`
    : `<p style="margin:0 0 26px;font-size:16px;line-height:1.65">${next}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#a83329"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:17px 24px;border:1px solid #a83329;color:#fff9ec;font-size:15px;line-height:1.25;font-weight:700;text-decoration:none">${action} &rarr;</a></td></tr></table>
<p style="margin:28px 0 0;font-size:13px;line-height:1.65;color:#56544d">${charge}</p>
<p style="margin:38px 0 0;font-family:Georgia,serif;font-size:29px;line-height:1.2">After the fear.</p>`;

  const greetingHtml = `<h2 style="margin:0 0 ${welcome ? "22" : "16"}px;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-.4px">${escapeHtml(greeting)}</h2>`;
  const helpHtml = `<p style="margin:0 0 12px;font-size:12px;line-height:1.6">Need a hand? <a href="mailto:connect@theruinedproject.com" style="color:${theme.ink};text-decoration:underline">Reply to us.</a></p>`;
  const footerHtml = `<p style="margin:0;font-size:11px;line-height:1.7;color:${theme.muted}">${footer}</p>`;
  const gmailStyles = welcome ? `
u + .ruined-email .gmail-blend-screen{background:#000;mix-blend-mode:screen}
u + .ruined-email .gmail-blend-difference{background:#000;mix-blend-mode:difference}
u + .ruined-email .gmail-blend-difference,u + .ruined-email .gmail-blend-difference *{color:#fff!important}
` : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="${welcome ? "dark" : "light"}"><title>${escapeHtml(subject)}</title>
<style>${gmailStyles}@media(max-width:480px){.email-pad{padding-left:24px!important;padding-right:24px!important}.email-title{font-size:42px!important}.email-outer{padding:0!important}}</style></head>
<body${welcome ? ' class="ruined-email"' : ""} style="margin:0;padding:0;background:${theme.outer};color:${theme.ink};font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${theme.outer}"><tr><td class="email-outer" align="center" style="padding:32px 12px">
<!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${theme.paper}"${textureAttribute} style="max-width:600px;background:${theme.paper}${textureStyle};color:${theme.ink};border-collapse:collapse">
<tr><td class="email-pad" style="padding:32px 40px 38px"><img src="${escapeHtml(logo)}" width="150" height="45" alt="Ruined" style="display:block;width:150px;height:45px;border:0"></td></tr>
${welcome ? "" : `<tr><td class="email-pad" style="padding:0 40px 32px">${eyebrow ? `<p style="margin:0 0 16px;font-size:11px;line-height:1.5;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#a83329">${eyebrow}</p>` : ""}<h1 class="email-title" style="margin:0;font-size:58px;line-height:1.02;letter-spacing:-2px;font-weight:700">${title}</h1></td></tr>`}
<tr><td style="padding:0;background:${welcome ? theme.paper : "#181816"}"><img src="${escapeHtml(imageUrl)}" width="600" alt="${escapeHtml(imageAlt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;color:#e9e5da;font-size:14px"></td></tr>
<tr><td class="email-pad" style="padding:36px 40px 40px;color:${theme.ink}">${welcome ? welcomeText(greetingHtml) : greetingHtml}${body}</td></tr>
<tr><td class="email-pad" style="padding:24px 40px 32px;border-top:1px solid ${theme.rule}">${welcome ? welcomeText(helpHtml) + welcomeText(footerHtml, theme.muted) : helpHtml + footerHtml}</td></tr>
</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
  return { subject, html, text };
}
