import { getPlatformConfiguration } from "@/lib/platform/config";
import { createRegistrationEmail } from "@/lib/membership/registration-email";

export const runtime="nodejs";
export const dynamic="force-dynamic";

/** Fictional local visual proof. Never exposes an actual recipient or sends mail. */
export function GET(request: Request) {
  if (process.env.NODE_ENV==="production" || getPlatformConfiguration().mode!=="preview") {
    return new Response("Not found",{status:404});
  }
  const url=new URL(request.url);
  const kind=url.searchParams.get("kind")==="profile_ready" ? "profile_ready" : "welcome";
  const message=createRegistrationEmail({kind,memberName:"Alex Rivera",
    completionBasis:url.searchParams.get("funding")==="complimentary" ? "complimentary" : "saved_card",
    invitationImageSrc:kind==="welcome" ? `/api/preview/registration-email/image?source=${url.searchParams.get("source")==="member" ? "member" : "direct"}` : undefined,
    siteUrl:new URL(url.origin)});
  // Next can normalize the request host to localhost while the browser uses
  // 127.0.0.1. Keep preview images on the browser's origin for its strict CSP;
  // the actual transactional email renderer retains absolute public URLs.
  const previewHtml=message.html.replaceAll(`${url.origin}/`,'/');
  const text=url.searchParams.get("format")==="text";
  return new Response(text ? message.text : previewHtml,{headers:{
    "Content-Type":text ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
    "Cache-Control":"private, no-store","X-Robots-Tag":"noindex, nofollow",
    "Content-Security-Policy":"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'",
  }});
}
