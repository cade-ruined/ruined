import { AdminEmailError, isAdminEmailAddress } from "./admin-email-model";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import type { ResendEmailEdits } from "./resend-email-model";
export type EmailGroupCampaignPurpose="general_updates"|"membership_updates";
export type EmailGroupCampaignDraft={id?:string;revision?:number;name:string;groupId:string;groupRevision:number;purpose:EmailGroupCampaignPurpose;templateId:string;templateVersion:string;edits:ResendEmailEdits};
export type EmailGroupCampaignRecipient={email:string;name:string;memberId?:string;personId?:string};
export type EmailGroupCampaignMessage={from:string;replyTo:string[];subject:string;html:string;text:string};
export const EMAIL_GROUP_CAMPAIGN_LIMIT=1000;
export const emailGroupPurposeLabel=(purpose:EmailGroupCampaignPurpose)=>purpose==="general_updates" ? "general group emails" : "membership group emails";
export const escapeEmailGroupHtml=(value:string)=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
export function personalizeEmailGroupMessage(message:EmailGroupCampaignMessage,recipient:EmailGroupCampaignRecipient,unsubscribeUrl:string):EmailGroupCampaignMessage {
  const url=new URL(unsubscribeUrl);
  if (url.protocol!=="https:" || url.username || url.password || !isAdminEmailAddress(recipient.email)) throw new AdminEmailError(400,"The recipient or unsubscribe link is invalid.");
  if ([message.from,...message.replyTo].some(value=>/\{\{|\}\}|[\r\n\0]/.test(value))) throw new AdminEmailError(400,"The sender and reply address cannot contain recipient personalization.");
  const names=recipient.name.trim().split(/\s+/).filter(Boolean);
  const values:Record<string,string>={"contact.first_name":names[0] ?? "","contact.last_name":names.slice(1).join(" "),"contact.email":recipient.email,FIRST_NAME:names[0] ?? "",LAST_NAME:names.slice(1).join(" "),EMAIL:recipient.email,RESEND_UNSUBSCRIBE_URL:unsubscribeUrl};
  function valueFor(key:string) {
      const [field,...fallback]=key.split("|");
      if (!Object.hasOwn(values,field.trim()) || fallback.length>1 || /[\r\n\0]/.test(key)) throw new AdminEmailError(400,"This design contains unsupported recipient personalization.");
      return values[field.trim()] || fallback[0] || "";
  }
  function expand(source:string) {
    const result=source.replace(/\{\{\{([^{}]+)\}\}\}/g,(_whole,key:string)=>valueFor(key));
    if (/\{\{|\}\}/.test(result)) throw new AdminEmailError(400,"This design still contains unresolved placeholders.");
    return result;
  }
  const subject=expand(message.subject);
  if (!subject.trim() || subject.length>200 || /[\r\n\0]/.test(subject)) throw new AdminEmailError(400,"The personalized subject is invalid.");
  type Node=DefaultTreeAdapterTypes.Node;
  const placements:Array<{start:number;end:number;attribute:boolean}>=[];
  const document=parse(message.html,{sourceCodeLocationInfo:true});
  const blocked=new Set(["script","style","textarea","iframe","object","embed","svg","math","template","noscript"]);
  const urlAttributes=new Set(["href","src","background"]);
  let unsubscribeLink=false;
  function visit(node:Node) {
    if ("tagName" in node) {
      if (blocked.has(node.tagName)) return;
      for (const attr of node.attrs) {
        const location=node.sourceCodeLocation?.attrs?.[attr.name];
        if (!location || ![...urlAttributes,"alt","title","aria-label"].includes(attr.name)) continue;
        placements.push({start:location.startOffset,end:location.endOffset,attribute:true});
        if (!/\{\{/.test(attr.value)) continue;
        const expanded=expand(attr.value);
        if (urlAttributes.has(attr.name)) {
          let resolved:URL;
          try { resolved=new URL(expanded); } catch { throw new AdminEmailError(400,"Personalized links must form complete, safe URLs."); }
          const protocols=attr.name==="href" ? ["https:","http:","mailto:","tel:"] : ["https:","http:","cid:"];
          if (!protocols.includes(resolved.protocol) || resolved.username || resolved.password || /[\u0000-\u0020\u007f-\u009f]/.test(expanded)) throw new AdminEmailError(400,"A personalized link uses an unsupported address.");
          if (node.tagName==="a" && attr.name==="href" && expanded===unsubscribeUrl) unsubscribeLink=true;
        }
      }
    } else if (node.nodeName==="#text" && node.sourceCodeLocation) {
      placements.push({start:node.sourceCodeLocation.startOffset,end:node.sourceCodeLocation.endOffset,attribute:false});
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  }
  visit(document);
  // Replace original source spans so authored layout and conditional markup survive.
  const html=message.html.replace(/\{\{\{([^{}]+)\}\}\}/g,(whole,key:string,offset:number)=>{
    const placement=placements.find(item=>offset>=item.start && offset+whole.length<=item.end);
    if (!placement) throw new AdminEmailError(400,"Recipient personalization appears inside unsupported layout or active code.");
    const escaped=escapeEmailGroupHtml(valueFor(key));
    return placement.attribute ? escaped.replace(/[\u0009-\u0020=`]/g,char=>`&#${char.charCodeAt(0)};`) : escaped;
  });
  if (/\{\{|\}\}/.test(html)) throw new AdminEmailError(400,"This design still contains unresolved placeholders.");
  if (!unsubscribeLink) throw new AdminEmailError(400,"This campaign needs a working unsubscribe link.");
  let text=expand(message.text);
  if (!text.includes(unsubscribeUrl)) text+=`\n\nUnsubscribe: ${unsubscribeUrl}`;
  return {...message,subject,html,text};
}
