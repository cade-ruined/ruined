import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { cadenceCopy, cadenceMessagesValidationError } from "./member-email-cadence-copy";
import { plainTextFromHtml, renderResendEmailTemplate } from "./resend-email-templates";
import { AdminEmailError } from "./admin-email-model";
import type { CadenceDelivery, CadenceDraft, CadencePlan, CadenceBindingSource, CadenceEmailPayload } from "./member-email-cadence-types";
import type { ResendEmailTemplate } from "./resend-email-model";

const BODY_MARKER="RUINED_CADENCE_BODY_48b79064";
const escape=(value:string)=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const SOURCES: CadenceBindingSource[]=["literal","member_name","call_title","call_date","call_time","call_url","profile_url","preferences_url"];

export function validateCadenceDesign(draft: Pick<CadenceDraft,"bodyTarget"|"headingTarget"|"bindings"|"copy"|"messages">,template: ResendEmailTemplate) {
  const messageError=cadenceMessagesValidationError(draft.messages);
  if (messageError) throw new AdminEmailError(400,messageError);
  if (template.status!=="published" || template.campaignOnly) throw new AdminEmailError(400,"Choose a published individual-email design from Resend.");
  const targets=new Set([...template.fields.map(field=>`copy:${field.key}`),...template.variables.filter(item=>item.type==="string").map(item=>`variable:${item.key}`)]);
  if (!targets.has(draft.bodyTarget) || (draft.headingTarget && (!targets.has(draft.headingTarget) || draft.headingTarget===draft.bodyTarget))) {
    throw new AdminEmailError(400,"Choose separate message and heading areas in this design.");
  }
  if (!draft.bindings || typeof draft.bindings!=="object" || Array.isArray(draft.bindings)) throw new AdminEmailError(400,"Review the design fields.");
  if (draft.copy!==undefined && (!draft.copy || typeof draft.copy!=="object" || Array.isArray(draft.copy)
    || Object.entries(draft.copy).some(([key,value])=>!template.fields.some(field=>field.key===key)
      || typeof value!=="string" || value.length>12000 || /\{\{|\u0000/.test(value)))) {
    throw new AdminEmailError(400,"Review the remaining design text without template placeholders.");
  }
  for (const [key,binding] of Object.entries(draft.bindings)) {
    if (!template.variables.some(item=>item.key===key) || !binding || !SOURCES.includes(binding.source)
      || (binding.source==="literal" && (typeof binding.value!=="string" || binding.value.length>6000 || /\{\{|\[.*(?:TBD|INSERT|LINK).*\]/i.test(binding.value)))) {
      throw new AdminEmailError(400,"Complete the design fields without unfinished placeholders.");
    }
  }
}

/** Only replace an inspected text node. A body variable in an attribute is never converted into HTML. */
function bodyHtml(html: string,body: string,links: string[],signOff?: string): string {
  const signature = "RUINED_CADENCE_SIGNATURE_9f62267d";
  const lastSignOff = body.lastIndexOf("\nAfter the fear.");
  if (signOff && lastSignOff >= 0) body = body.slice(0,lastSignOff) + "\n" + signature + body.slice(lastSignOff + "\nAfter the fear.".length);
  const document=parse(html,{sourceCodeLocationInfo:true});
  const replacements: Array<{start:number;end:number;value:string}>=[];
  function visit(node: DefaultTreeAdapterTypes.Node,blocked=false) {
    const hidden=blocked || ("tagName" in node && (["head","script","style","textarea","svg","iframe"].includes(node.tagName)
      || node.attrs.some(item=>item.name==="hidden" || item.name==="aria-hidden" && item.value.toLowerCase()==="true"
        || item.name==="style" && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)(?:\s*!important)?\s*(?:;|$)/i.test(item.value))));
    if (node.nodeName==="#text" && "value" in node && node.value.includes(BODY_MARKER) && node.sourceCodeLocation && !hidden) {
      const location=node.sourceCodeLocation;
      const source=html.slice(location.startOffset,location.endOffset);
      const alternatives=links.map(link=>link.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).sort((a,b)=>b.length-a.length);
      const split=new RegExp(`(${alternatives.join("|")})`,"g");
      let rendered=(alternatives.length ? body.split(split) : [body]).map(part=>links.includes(part)
        ? `<a href="${escape(part)}" style="color:#ffca2c;overflow-wrap:anywhere;word-break:break-word;text-decoration:underline">${escape(part)}</a>` : escape(part).replaceAll("\n","<br>")).join("");
      if (signOff) rendered=rendered.replace(signature,signOff);
      replacements.push({start:location.startOffset,end:location.endOffset,value:source.replaceAll(BODY_MARKER,rendered)});
    }
    if ("childNodes" in node) node.childNodes.forEach(child=>visit(child,hidden));
  }
  visit(document);
  if (!replacements.length) throw new AdminEmailError(400,"The message area must be visible text in the design.");
  for (const item of replacements.sort((a,b)=>b.start-a.start)) html=html.slice(0,item.start)+item.value+html.slice(item.end);
  if (html.includes(BODY_MARKER)) throw new AdminEmailError(400,"The message area cannot also be used in a link, image, or hidden field.");
  return html;
}

export type CadenceDesignPlan = Pick<CadencePlan,"template"|"bodyTarget"|"headingTarget"|"bindings"|"copy"|"siteUrl">;
export type CadenceDesignMessage = { subject: string; heading: string; body: string; memberName: string; links?: string[] };

/** Reuse only the approved After-the-fear artwork. A different managed sign-off
 * never adds unrelated wording to an approved message. Original asset geometry
 * is retained; its alternative text carries the exact approved closing. */
function matchingSignature(template: ResendEmailTemplate,body: string): string | undefined {
  if (!body.includes("\nAfter the fear.")) return;
  // The official 440×84 asset is displayed at half size without changing its geometry.
  const official='<img data-ruined-sign-off="true" src="https://members.theruinedproject.com/membership/email/after-the-fear-cadehandy2.png" alt="After the fear." width="220" height="42" style="display:block;width:220px;max-width:100%;height:auto;border:0">';
  if (template.signOffText?.trim().replace(/[.!]$/,"").toLowerCase()!=="after the fear") return template.signOffText ? official : undefined;
  const document=parse(template.html,{sourceCodeLocationInfo:true}); let markup: string | undefined;
  function visit(node: DefaultTreeAdapterTypes.Node) {
    if (markup) return;
    if ("tagName" in node && node.tagName==="img" && node.sourceCodeLocation) {
      const attr=(name:string)=>node.attrs.find(item=>item.name===name)?.value;
      if ((attr("data-ruined-sign-off")!==undefined || /(?:^|\/)after-the-fear-cadehandy2\.png(?:[?#].*)?$/.test(attr("src") ?? ""))
        && /^https:\/\//.test(attr("src") ?? "") && !attr("src")?.includes("{{")) {
        const location=node.sourceCodeLocation; markup=template.html.slice(location.startOffset,location.endOffset);
        const alt=location.attrs?.alt;
        if (alt) markup=markup.slice(0,alt.startOffset-location.startOffset)+'alt="After the fear."'+markup.slice(alt.endOffset-location.startOffset);
        else markup=markup.replace(/^<img/i,'<img alt="After the fear."');
        return;
      }
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  }
  visit(document);return markup ?? official;
}
function renderDesign(plan: CadenceDesignPlan,message: CadenceDesignMessage,sources: Record<string,string>) {
  validateCadenceDesign(plan,plan.template);
  for (const link of message.links ?? []) {
    let url: URL;
    try { url=new URL(link); } catch { throw new AdminEmailError(400,"Use complete website links in the message."); }
    if (!["https:","http:"].includes(url.protocol) || url.username || url.password || /[\u0000-\u0020\u007f]/.test(link)) throw new AdminEmailError(400,"Use complete website links in the message.");
  }
  const values: Record<string,string>={};const edits: Record<string,string>={...plan.copy};
  for (const [key,binding] of Object.entries(plan.bindings)) {
    if (binding.source!=="literal" && !Object.hasOwn(sources,binding.source)) throw new AdminEmailError(400,"This design uses call-specific fields. Choose a message design without call bindings.");
    values[key]=binding.source==="literal" ? binding.value ?? "" : sources[binding.source];
  }
  const set=(target:string,value:string)=>{const key=target.slice(target.indexOf(":")+1);if(target.startsWith("variable:")) values[key]=value;else edits[key]=value;};
  set(plan.bodyTarget,BODY_MARKER);if(plan.headingTarget)set(plan.headingTarget,message.heading);
  const artwork=matchingSignature(plan.template,message.body);
  const rendered=renderResendEmailTemplate(plan.template,{subject:message.subject,values,copy:edits,typography:"ruined",signOff:null},{campaign:false});
  const html=bodyHtml(rendered.html,message.body,message.links ?? [],artwork);
  let text=plainTextFromHtml(html,true);
  for (const link of message.links ?? []) text=text.replaceAll(`${link} (${link})`,link);
  if (artwork) text=text.replace("RU/NED\n\nAfter the fear.","RU/NED\nAfter the fear.");
  return {...rendered,from:rendered.from || process.env.RESEND_FROM_EMAIL?.trim() || "",html,text};
}

/** Render an approved lifecycle message without importing call details or
 * accepting browser-provided HTML. This function does not persist or send. */
export function renderCadenceDesignMessage(plan: CadenceDesignPlan,message: CadenceDesignMessage) {
  const site=new URL(plan.siteUrl);
  if (!["https:","http:"].includes(site.protocol) || site.username || site.password) throw new AdminEmailError(400,"Choose a valid membership website address.");
  const profile=new URL("/my",site).toString(),preferences=new URL("/my/account#email-reminders",site).toString();
  return renderDesign(plan,message,{member_name:message.memberName,profile_url:profile,preferences_url:preferences});
}

export function renderCadenceEmail(delivery: Pick<CadenceDelivery,"plan"|"event"|"stage"|"memberName"|"email">): CadenceEmailPayload {
  const {plan,event,stage}=delivery;
  validateCadenceDesign(plan,plan.template);
  const copy=cadenceCopy({event,kind:plan.kind,track:plan.track,stage,memberName:delivery.memberName,siteUrl:plan.siteUrl,message:plan.messages?.[stage]});
  const sources: Record<Exclude<CadenceBindingSource,"literal">,string>={
    member_name:delivery.memberName,call_title:event.title,
    call_date:new Intl.DateTimeFormat("en-US",{timeZone:event.timeZone,weekday:"long",month:"long",day:"numeric",year:"numeric"}).format(new Date(event.startsAt)),
    call_time:new Intl.DateTimeFormat("en-US",{timeZone:event.timeZone,hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(event.startsAt)),
    call_url:copy.callUrl,profile_url:copy.profileUrl,preferences_url:copy.preferencesUrl,
  };
  return {...renderDesign(plan,{subject:copy.subject,heading:copy.heading,body:copy.body,memberName:delivery.memberName,
    links:[copy.callUrl,copy.profileUrl,copy.preferencesUrl]},sources),to:delivery.email};
}

export function cadencePreviewPlan(draft: CadenceDraft,template: ResendEmailTemplate,event: CadencePlan["event"]): CadencePlan {
  return {...draft,template,event,siteUrl:"https://members.theruinedproject.com",id:"preview",revision:1,active:false,activatedAt:new Date().toISOString()};
}
