/** The profile-release guide is service content. Its screenshots use a fictional
 * member and remain outside editable copy, along with privacy and access steps. */
export const PROFILE_READY_TEMPLATE = {
  subject: "Your Ruined profile is ready",
  body: [
    "{{member_name}}, your Ruined profile is now open.",
    "Start with a photo and a few words. Then find your first call. The rest can grow from there.",
  ].join("\n\n"),
};

type ProfileReadyEmailInput = {
  memberName: string;
  siteUrl: URL;
  billingNote: string;
  template: { subject: string; body: string };
};

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// Gmail iOS recolors text over images. The same paired blend layers used by the
// verified welcome email keep live text readable without altering screenshots.
function inkText(html: string) {
  return `<div class="gmail-blend-screen"><div class="gmail-blend-difference" style="color:#e9e4d9">${html}</div></div>`;
}

export function createProfileReadyEmail(input: ProfileReadyEmailInput) {
  const absolute = (path: string) => new URL(path, input.siteUrl).toString();
  const profileUrl = absolute("/my");
  const values: Record<string, string> = {
    "{{member_name}}": input.memberName.trim() || "Friend",
    "{{profile_url}}": profileUrl,
  };
  const resolve = (copy: string) => copy.replace(/\{\{[a-z_]+\}\}/g, token => values[token]);
  const subject = resolve(input.template.subject);
  if (subject.length > 200 || /[\r\n\u0000]/.test(subject)) {
    throw new Error("The personalized subject is too long or contains an invalid character.");
  }
  const [greeting, ...intro] = resolve(input.template.body).split(/\n\s*\n/);
  const logo = absolute("/ruined-wordmark-email-bone.png");
  const texture = absolute("/membership/design/printers-ink.jpg");
  const signoff = absolute("/membership/email/after-the-fear-cadehandy2.png");
  const link = (path: string, label: string) => `<a href="${escapeHtml(absolute(path))}" style="color:#e9e4d9;text-decoration:underline;font-weight:700">${escapeHtml(label)} &rarr;</a>`;
  const screenshot = (name: string, alt: string) => `<img src="${escapeHtml(absolute(`/membership/email/profile-guide/${name}.jpg`))}" width="520" alt="${escapeHtml(alt)}" style="display:block;width:100%;max-width:520px;height:auto;border:0;color:#e9e4d9;font-size:14px;line-height:1.5">`;
  const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#ffca2c" style="background:#ffca2c;background-image:linear-gradient(#ffca2c,#ffca2c)"><a href="${escapeHtml(profileUrl)}" style="display:inline-block;padding:18px 26px;border:1px solid #ffca2c;color:#10100f;font-size:16px;line-height:1.25;font-weight:700;text-decoration:none">Open your profile &rarr;</a></td></tr></table>`;
  const paragraph = (html: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.65">${html}</p>`;
  const heading = (number: string, title: string) => inkText(`<p style="margin:0 0 10px;font-size:11px;font-weight:700;line-height:1.5;letter-spacing:2px">${number}</p><h2 style="margin:0 0 18px;font-size:28px;line-height:1.15;font-weight:700;letter-spacing:-.6px">${title}</h2>`);
  const section = (content: string) => `<tr><td class="email-pad" style="padding:32px 40px;border-top:1px solid #49463e;color:#e9e4d9">${content}</td></tr>`;
  const footer = "This is an update about your Ruined membership, not a newsletter subscription.";
  const text = [
    greeting, "", ...intro.flatMap(copy => [copy, ""]),
    `Open your profile: ${profileUrl}`, "",
    "Sign in with the email you used to register. Enter the confirmation code sent to your inbox.", "",
    "01 / MAKE IT YOURS",
    "Choose Edit profile. Add your photo and a short bio. If you don’t have an @tag yet, choose one here—it’s permanent.",
    "Your photo, bio, @tag, earned badges and Timeline appear on your public profile. Use View public profile to see what others see.",
    `Edit profile: ${absolute("/my/profile")}`, "",
    "02 / KEEP A THOUGHT. OR SHARE IT.",
    "Journal is private. Choose Write privately and save a few words just for you. Check Add to Timeline only when you want that entry on your public profile.",
    "Timeline is public. Create a post with a thought, photo or moment. Go deeper is optional if you want prompts to help you reflect.",
    `Your Journal: ${absolute("/my#journal")}`,
    `Create a Timeline post: ${absolute("/my/timeline/new")}`, "",
    "03 / FIND YOUR NEXT CALL",
    "Open Calendar from the menu for your scheduled calls. Select a call, then choose Join room to open Google Meet.",
    "Foundations holds your session materials. My Circle will open when your placement is ready; we’ll let you know.",
    `Open Calendar: ${absolute("/my/experiences")}`,
    `Foundations: ${absolute("/my/foundations")}`, "",
    "A FEW THINGS TO EARN ALONG THE WAY",
    "Make It Yours: add a photo, bio and @tag. First Words: save your first private Journal entry. In the Room: attend your first Foundations or Membership call.",
    `See your badges: ${absolute("/my/badges")}`, "",
    "Start wherever you like. You don’t need to finish everything in one visit.",
    `Open your profile: ${profileUrl}`, "",
    input.billingNote, "", "After the fear.", "",
    "Need a hand? Reply to this email or write to connect@theruinedproject.com.",
    "Screenshots show a demonstration profile. Your name, badges and calendar will be your own.", footer,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(subject)}</title>
<style>
u + .ruined-email .gmail-blend-screen{background:#000;mix-blend-mode:screen}
u + .ruined-email .gmail-blend-difference{background:#000;mix-blend-mode:difference}
u + .ruined-email .gmail-blend-difference,u + .ruined-email .gmail-blend-difference *{color:#fff!important}
@media(max-width:480px){.email-pad{padding-left:24px!important;padding-right:24px!important}.email-title{font-size:40px!important}.email-outer{padding:0!important}}
</style></head>
<body class="ruined-email" style="margin:0;padding:0;background:#080807;color:#e9e4d9;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">Your profile is open. Here’s a quick look around.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#080807"><tr><td class="email-outer" align="center" style="padding:32px 12px">
<!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#10100f" background="${escapeHtml(texture)}" style="max-width:600px;background:#10100f;background-image:url('${escapeHtml(texture)}'),linear-gradient(#10100f,#10100f);background-position:center top;background-size:600px auto;background-repeat:repeat;color:#e9e4d9;border-collapse:collapse">
<tr><td class="email-pad" style="padding:36px 40px 32px"><img src="${escapeHtml(logo)}" width="150" height="45" alt="RU/NED" style="display:block;width:150px;height:45px;border:0"></td></tr>
<tr><td class="email-pad" style="padding:0 40px 32px;color:#e9e4d9">${inkText(`<p style="margin:0 0 16px;font-size:11px;font-weight:700;line-height:1.5;letter-spacing:2px">YOUR SPACE IS OPEN</p><h1 class="email-title" style="margin:0 0 28px;font-size:52px;line-height:1.04;font-weight:700;letter-spacing:-1.8px">Make yourself<br>at home.</h1>${paragraph(`<strong>${escapeHtml(greeting).replaceAll("\n", "<br>")}</strong>`)}${intro.map(copy => paragraph(escapeHtml(copy).replaceAll("\n", "<br>"))).join("")}`)}
<div style="height:8px;line-height:8px;font-size:1px" aria-hidden="true">&nbsp;</div>${button}
${inkText(`<p style="margin:18px 0 0;font-size:13px;line-height:1.6">Sign in with the email you used to register. Enter the confirmation code sent to your inbox.</p>`)}</td></tr>
${section(`${heading("01 / PROFILE", "Make it yours.")}${inkText(paragraph("Choose <strong>Edit profile</strong>. Add your photo and a short bio. If you don’t have an <strong>@tag</strong> yet, choose one here—it’s permanent."))}${screenshot("profile", "Demo member profile showing the photo, name, @tag and Edit profile button.")}${inkText(`<p style="margin:18px 0 16px;font-size:14px;line-height:1.65">Your photo, bio, @tag, earned badges and Timeline appear on your public profile. Use <strong>View public profile</strong> to see what others see.</p>${paragraph(link("/my/profile", "Edit profile"))}`)}`)}
${section(`${heading("02 / JOURNAL + TIMELINE", "Keep a thought.<br>Or share it.")}${inkText(paragraph("<strong>Journal is private.</strong> Choose <strong>Write privately</strong> and save a few words just for you. Check <strong>Add to Timeline</strong> only when you want that entry on your public profile.")+paragraph("<strong>Timeline is public.</strong> Create a post with a thought, photo or moment. <strong>Go deeper</strong> is optional if you want prompts to help you reflect."))}${screenshot("timeline", "Demo Create something menu with separate Journal (Private) and Timeline (Public) choices.")}${inkText(`<p style="margin:18px 0 0;font-size:15px;line-height:1.9">${link("/my#journal", "Your Journal")}<br>${link("/my/timeline/new", "Create a Timeline post")}</p>`)}`)}
${section(`${heading("03 / CALENDAR", "Find your next call.")}${inkText(paragraph("Open <strong>Calendar</strong> from the menu for your scheduled calls. Select a call, then choose <strong>Join room</strong> to open Google Meet."))}${screenshot("calendar", "Demo Foundations call opened from Calendar, showing its date, time, Google Meet location and Join room button.")}${inkText(`<p style="margin:18px 0 16px;font-size:14px;line-height:1.65"><strong>Foundations</strong> holds your session materials. <strong>My Circle</strong> will open when your placement is ready; we’ll let you know.</p><p style="margin:0;font-size:15px;line-height:1.9">${link("/my/experiences", "Open Calendar")}<br>${link("/my/foundations", "Foundations")}</p>`)}`)}
${section(`${inkText(`<h2 style="margin:0 0 16px;font-size:23px;line-height:1.25;letter-spacing:-.4px">A few things to earn along the way.</h2><p style="margin:0 0 18px;font-size:14px;line-height:1.75"><strong>Make It Yours</strong> — add a photo, bio and @tag.<br><strong>First Words</strong> — save your first private Journal entry.<br><strong>In the Room</strong> — attend your first Foundations or Membership call.</p>${paragraph(link("/my/badges", "See your badges"))}<p style="margin:26px 0 24px;font-size:16px;line-height:1.65">Start wherever you like. You don’t need to finish everything in one visit.</p>`)}${button}${inkText(`<p style="margin:28px 0 24px;font-size:12px;line-height:1.65">${escapeHtml(input.billingNote)}</p>`)}<img src="${escapeHtml(signoff)}" width="220" alt="After the fear." style="display:block;width:220px;max-width:100%;height:auto;border:0;color:#ffca2c">`)}
${section(inkText(`<p style="margin:0 0 16px;font-size:13px;line-height:1.65">Need a hand? <a href="mailto:connect@theruinedproject.com" style="color:#e9e4d9;text-decoration:underline">Reply to us.</a></p><p style="margin:0 0 12px;font-size:11px;line-height:1.65">Screenshots show a demonstration profile. Your name, badges and calendar will be your own.</p><p style="margin:0;font-size:11px;line-height:1.65">${footer}</p>`))}
</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
  return { subject, html, text };
}
