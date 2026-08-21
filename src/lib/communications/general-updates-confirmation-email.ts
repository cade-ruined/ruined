export type GeneralUpdatesConfirmationEmail = {
  html: string;
  subject: string;
  text: string;
};

type GeneralUpdatesConfirmationEmailInput = {
  confirmationUrl: string;
  siteUrl: URL;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function createGeneralUpdatesConfirmationEmail(
  input: GeneralUpdatesConfirmationEmailInput,
): GeneralUpdatesConfirmationEmail {
  const confirmationUrl = input.confirmationUrl;
  const wordmarkUrl = new URL("/ruined-wordmark-email.png", input.siteUrl).toString();
  const ivyOraUrl = new URL("/fonts/IvyOraText-Regular.ttf", input.siteUrl).toString();
  const interUrl = new URL("/fonts/Inter-Variable-Latin.woff2", input.siteUrl).toString();
  const escapedConfirmationUrl = escapeHtml(confirmationUrl);
  const escapedWordmarkUrl = escapeHtml(wordmarkUrl);
  const escapedIvyOraUrl = escapeHtml(ivyOraUrl);
  const escapedInterUrl = escapeHtml(interUrl);

  return {
    subject: "Confirm your email",
    text: [
      "Confirm this email address to receive the Ruined updates you requested.",
      "",
      confirmationUrl,
      "",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta content="text/html; charset=utf-8" http-equiv="Content-Type">',
      '<meta content="width=device-width, initial-scale=1" name="viewport">',
      '<meta content="light" name="color-scheme">',
      '<meta content="light" name="supported-color-schemes">',
      "<style>",
      `@font-face{font-family:"IvyOra Text";font-style:normal;font-weight:400;src:url("${escapedIvyOraUrl}") format("truetype")}`,
      `@font-face{font-family:"Inter Ruined";font-style:normal;font-weight:100 900;src:url("${escapedInterUrl}") format("woff2")}`,
      "</style>",
      "</head>",
      '<body style="background:#E5E0D5;color:#2A2A2A;margin:0;padding:0;width:100%">',
      '<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">One final step to receive Ruined updates.</div>',
      '<table bgcolor="#E5E0D5" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#E5E0D5;border-collapse:collapse;width:100%" width="100%">',
      '<tr><td align="center" style="padding:48px 24px 56px">',
      '<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;max-width:560px;width:100%" width="100%">',
      `<tr><td style="padding:0 0 64px"><img alt="RUINED" height="54" src="${escapedWordmarkUrl}" style="border:0;display:block;height:54px;max-width:100%;width:180px" width="180"></td></tr>`,
      '<tr><td style="color:#D0312D;font-family:&quot;Inter Ruined&quot;,Inter,&quot;Helvetica Neue&quot;,Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.26em;line-height:1.25;padding:0 0 18px;text-transform:uppercase">Ruined updates</td></tr>',
      '<tr><td style="color:#2A2A2A;font-family:&quot;IvyOra Text&quot;,&quot;Iowan Old Style&quot;,Baskerville,Georgia,Cambria,&quot;Times New Roman&quot;,Times,serif;font-size:46px;font-weight:400;letter-spacing:-0.04em;line-height:0.98;padding:0 0 28px">Confirm what you chose.</td></tr>',
      '<tr><td style="color:#2A2A2A;font-family:&quot;Inter Ruined&quot;,Inter,&quot;Helvetica Neue&quot;,Helvetica,Arial,sans-serif;font-size:16px;font-weight:400;letter-spacing:-0.01em;line-height:1.55;padding:0 0 32px">You asked to receive Ruined updates. Confirm this email address to finish.</td></tr>',
      '<tr><td style="padding:0 0 56px">',
      '<table border="0" cellpadding="0" cellspacing="0" role="presentation"><tr><td bgcolor="#2A2A2A" style="background:#2A2A2A">',
      `<a href="${escapedConfirmationUrl}" style="color:#E5E0D5;display:inline-block;font-family:&quot;Inter Ruined&quot;,Inter,&quot;Helvetica Neue&quot;,Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.22em;line-height:1;padding:18px 24px;text-decoration:none;text-transform:uppercase">Confirm email</a>`,
      "</td></tr></table>",
      "</td></tr>",
      '<tr><td style="border-top:1px solid rgba(42,42,42,0.18);color:#706B63;font-family:&quot;Inter Ruined&quot;,Inter,&quot;Helvetica Neue&quot;,Helvetica,Arial,sans-serif;font-size:12px;font-weight:400;line-height:1.55;padding:24px 0 0">If you did not request this, you can ignore this email.</td></tr>',
      "</table>",
      "</td></tr>",
      "</table>",
      "</body>",
      "</html>",
    ].join(""),
  };
}
