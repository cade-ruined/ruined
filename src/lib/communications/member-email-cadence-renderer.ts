import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { cadenceCopy, cadenceMessagesValidationError } from "./member-email-cadence-copy";
import { plainTextFromHtml, renderResendEmailTemplate } from "./resend-email-templates";
import { AdminEmailError } from "./admin-email-model";
import type { CadenceDelivery, CadenceDraft, CadencePlan, CadenceBindingSource, CadenceEmailPayload } from "./member-email-cadence-types";
import type { ResendEmailTemplate } from "./resend-email-model";

const BODY_MARKER="RUINED_CADENCE_BODY_48b79064";
const escape=(value:string)=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const SOURCES: CadenceBindingSource[]=["literal","member_name","call_title","call_date","call_time","call_url","profile_url","preferences_url"];

export function validateCadenceDesign(draft: CadenceDraft,template: ResendEmailTemplate) {
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
function bodyHtml(html: string,body: string,links: string[]): string {
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
      const rendered=body.split(split).map(part=>links.includes(part)
        ? `<a href="${escape(part)}" style="color:#ffca2c;overflow-wrap:anywhere;word-break:break-word;text-decoration:underline">${escape(part)}</a>` : escape(part).replaceAll("\n","<br>")).join("");
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
  const values: Record<string,string>={}; const edits: Record<string,string>={...plan.copy};
  for (const [key,binding] of Object.entries(plan.bindings)) values[key]=binding.source==="literal" ? binding.value ?? "" : sources[binding.source];
  const set=(target:string,value:string)=>{ const colon=target.indexOf(":"); const key=target.slice(colon+1);
    if (target.startsWith("variable:")) values[key]=value; else edits[key]=value; };
  set(plan.bodyTarget,BODY_MARKER);
  if (plan.headingTarget) set(plan.headingTarget,copy.heading);
  // The approved Resend artwork remains the sign-off where one exists.
  const body=plan.template.signOffText ? copy.body.replace(/\n\nAll the love,\nRU\/NED$/,"") : copy.body;
  const rendered=renderResendEmailTemplate(plan.template,{subject:copy.subject,values,copy:edits,typography:"ruined"},{campaign:false});
  const html=bodyHtml(rendered.html,body,[copy.callUrl,copy.profileUrl,copy.preferencesUrl]);
  return {...rendered,to:delivery.email,from:rendered.from || process.env.RESEND_FROM_EMAIL?.trim() || "",
    html,text:plainTextFromHtml(html,true)};
}

export function cadencePreviewPlan(draft: CadenceDraft,template: ResendEmailTemplate,event: CadencePlan["event"]): CadencePlan {
  return {...draft,template,event,siteUrl:"https://members.theruinedproject.com",id:"preview",revision:1,active:false,activatedAt:new Date().toISOString()};
}
