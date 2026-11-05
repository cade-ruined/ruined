import { PRACTICE_RECAPS, practiceAssignmentUrl, type PracticeReleaseCourse } from "./release-model";
import type { CadenceEmailPayload } from "@/lib/communications/member-email-cadence-types";

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const siteUrl = "https://members.theruinedproject.com";
const bodyFont = "'InterRuined',Inter,'Helvetica Neue',Helvetica,Arial,sans-serif";
const headingFont = "'IvyOraRuined',Georgia,'Times New Roman',serif";

// Match the membership welcome/profile emails. Gmail's paired blend layers
// protect live bone text; artwork and yellow buttons stay outside these layers.
function inkText(html: string) {
  return `<div class="gmail-blend-screen"><div class="gmail-blend-difference" style="color:#e9e4d9">${html}</div></div>`;
}

export function renderPracticeRecap(course: PracticeReleaseCourse, name: string, email: string, from: string): CadenceEmailPayload {
  const copy = PRACTICE_RECAPS[course];
  const link = practiceAssignmentUrl(course);
  const preferences = `${siteUrl}/my/account`;
  const texture = `${siteUrl}/membership/design/printers-ink.jpg`;
  const paragraph = (value: string) => `<p style="margin:0 0 18px;font-size:16px;line-height:1.7">${esc(value)}</p>`;
  const badgeImage = course === "time" ? "" : `<img src="${siteUrl}/membership/badges/foundations-${course}-v2.png" width="112" alt="${course.toUpperCase()} Badge" style="display:block;width:112px;height:auto;border:0;margin:0 0 24px">`;
  const text = [`${name},`, copy.heading, ...copy.paragraphs, copy.assignment, ...copy.steps.map((s, i) => `${i + 1}. ${s}`), copy.closing, `Open The Work: ${link}`, "RUINED · After the fear.", `Membership email preferences: ${preferences}`].join("\n\n");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${esc(copy.subject)}</title>
<style>
@font-face{font-family:'IvyOraRuined';font-style:normal;font-weight:500;src:url('${siteUrl}/fonts/IvyOraText-Medium.ttf') format('truetype');mso-font-alt:Georgia;}
@font-face{font-family:'InterRuined';font-style:normal;font-weight:100 900;src:url('${siteUrl}/fonts/Inter-Variable-Latin.woff2') format('woff2');mso-font-alt:Arial;}
u + .ruined-email .gmail-blend-screen{background:#000;mix-blend-mode:screen}
u + .ruined-email .gmail-blend-difference{background:#000;mix-blend-mode:difference}
u + .ruined-email .gmail-blend-difference,u + .ruined-email .gmail-blend-difference *{color:#fff!important}
@media(max-width:480px){.email-pad{padding-left:24px!important;padding-right:24px!important}.email-title{font-size:38px!important}.email-outer{padding:0!important}}
</style></head>
<body class="ruined-email" style="margin:0;padding:0;background:#080807;color:#e9e4d9;font-family:${bodyFont};-webkit-text-size-adjust:100%">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#080807"><tr><td class="email-outer" align="center" style="padding:32px 12px">
<!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#10100f" background="${texture}" style="max-width:600px;background:#10100f;background-image:url('${texture}'),linear-gradient(#10100f,#10100f);background-position:center top;background-size:600px auto;background-repeat:repeat;color:#e9e4d9;font-family:${bodyFont};border-collapse:collapse">
<tr><td class="email-pad" style="padding:36px 40px 36px"><img src="${siteUrl}/ruined-wordmark-email-bone.png" width="150" height="45" alt="RU/NED" style="display:block;width:150px;height:45px;border:0"></td></tr>
<tr><td class="email-pad" style="padding:0 40px 14px;color:#e9e4d9">${inkText(`<p style="margin:0 0 18px;font-size:11px;font-weight:600;line-height:1.5;letter-spacing:2px">${esc(copy.title.toUpperCase())}</p><h1 class="email-title" style="margin:0 0 30px;font-family:${headingFont};font-size:48px;line-height:1.08;font-weight:500;letter-spacing:-.8px">${esc(copy.heading)}</h1>${paragraph(`${name},`)}${copy.paragraphs.map(paragraph).join("")}`)}</td></tr>
<tr><td class="email-pad" style="padding:32px 40px 36px;border-top:1px solid #49463e;color:#e9e4d9">
${badgeImage}
${inkText(`<h2 style="margin:0 0 18px;font-family:${headingFont};font-size:30px;line-height:1.2;font-weight:500">Your next step</h2>${paragraph(copy.assignment)}<ol style="margin:0 0 22px;padding-left:24px;font-size:16px;line-height:1.7">${copy.steps.map(s => `<li style="padding:0 0 6px">${esc(s)}</li>`).join("")}</ol>${paragraph(copy.closing)}`)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px"><tr><td bgcolor="#ffca2c" style="background:#ffca2c;background-image:linear-gradient(#ffca2c,#ffca2c)"><a href="${link}" style="display:inline-block;padding:18px 26px;border:1px solid #ffca2c;color:#10100f;font-family:${bodyFont};font-size:16px;line-height:1.25;font-weight:700;text-decoration:none">Open The Work →</a></td></tr></table>
<img data-ruined-sign-off="true" src="${siteUrl}/membership/email/after-the-fear-cadehandy2.png" width="220" height="42" alt="After the fear." style="display:block;width:220px;max-width:100%;height:auto;border:0;margin-top:36px;color:#ffca2c">
</td></tr>
<tr><td class="email-pad" style="padding:24px 40px 30px;border-top:1px solid #49463e;color:#e9e4d9">${inkText(`<p style="margin:0;font-size:12px;line-height:1.6"><a href="${preferences}" style="color:#e9e4d9;text-decoration:underline">Membership email preferences</a></p>`)}</td></tr>
</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
  return { from, to: email, replyTo: ["connect@theruinedproject.com"], subject: copy.subject, html, text };
}
