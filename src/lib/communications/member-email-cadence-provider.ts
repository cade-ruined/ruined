import "server-only";
import { CadenceDeliveryError } from "./member-email-cadence-repository";
import { assertAdminEmailAccess } from "./admin-email-repository";
import type { ResendEmailTemplateSummary } from "./resend-email-model";
import type { CadenceRecipient } from "./member-email-cadence-types";

let nextRequestAt = 0;
/** Provider reads and sends share one request schedule within this worker instance. */
export async function reserveCadenceProviderSlot(deadline: number): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now,nextRequestAt);
  if (!Number.isFinite(deadline) || slot>=deadline) throw new CadenceDeliveryError("delivery_budget");
  nextRequestAt=slot+550;
  const delay=slot-now;
  if (delay) await new Promise(resolve => setTimeout(resolve,delay));
  if (Date.now()>=deadline) throw new CadenceDeliveryError("delivery_budget");
}
async function get<T>(path: string, deadline: number, allowMissing = false): Promise<T | null> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new CadenceDeliveryError("provider_unconfigured");
  await reserveCadenceProviderSlot(deadline);
  let response: Response;
  try {
    response = await fetch(`https://api.resend.com${path}`,{cache:"no-store",headers:{Authorization:`Bearer ${key}`},
      signal:AbortSignal.timeout(Math.max(1,Math.min(6000,deadline-Date.now())))});
  } catch { throw new CadenceDeliveryError("provider_preferences_unavailable"); }
  if (allowMissing && response.status===404) return null;
  if (!response.ok) throw new CadenceDeliveryError("provider_preferences_unavailable");
  try {
    const data:unknown=await response.json();
    if (data===null || typeof data!=="object" || Array.isArray(data)) throw new Error("Invalid provider record");
    return data as T;
  } catch { throw new CadenceDeliveryError("provider_preferences_unavailable"); }
}
async function all<T extends {id:string}>(path: string,deadline: number,maximum=10000): Promise<T[]> {
  const items: T[]=[]; const seen=new Set<string>(); let cursor="";
  for (;;) {
    const page=await get<{data:T[];has_more:boolean}>(`${path}?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`,deadline);
    if (!page || !Array.isArray(page.data) || typeof page.has_more!=="boolean") throw new CadenceDeliveryError("provider_preferences_unavailable");
    for (const item of page.data) {
      if (!item || typeof item.id!=="string" || !item.id || seen.has(item.id)) throw new CadenceDeliveryError("provider_preferences_unavailable");
      seen.add(item.id); items.push(item);
    }
    if (items.length>maximum) throw new CadenceDeliveryError("provider_review_limit");
    if (!page.has_more) return items;
    cursor=page.data.at(-1)?.id ?? "";
    if (!cursor || items.length>=maximum) throw new CadenceDeliveryError("provider_review_limit");
  }
}
async function suppressions(deadline: number) {
  const rows=await all<{id:string;email:string}>("/suppressions",deadline);
  if (rows.some(row => typeof row.email!=="string" || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(row.email))) throw new CadenceDeliveryError("provider_preferences_unavailable");
  return new Set(rows.map(row=>row.email.toLowerCase()));
}
async function unsubscribed(email: string,deadline: number): Promise<boolean> {
  const contact=await get<{unsubscribed:boolean}>(`/contacts/${encodeURIComponent(email)}`,deadline,true);
  if (contact===null) return false;
  if (typeof contact.unsubscribed!=="boolean") throw new CadenceDeliveryError("provider_preferences_unavailable");
  return contact.unsubscribed;
}
export async function assertCadenceRecipientDeliverable(email: string,options: {deadline?:number}={}) {
  const deadline=options.deadline ?? Date.now()+15000;
  if ((await suppressions(deadline)).has(email.toLowerCase()) || await unsubscribed(email,deadline)) {
    throw new CadenceDeliveryError("recipient_suppressed",true);
  }
}
/** Review and dispatch both fail closed if provider preference evidence cannot be read. */
export async function reviewCadenceProviderRecipients(recipients: CadenceRecipient[]): Promise<CadenceRecipient[]> {
  if (!recipients.some(item=>item.eligible)) return recipients;
  const deadline=Date.now()+240000;
  const suppressed=await suppressions(deadline);
  const result: CadenceRecipient[]=[];
  for (const recipient of recipients) {
    const excluded=recipient.eligible && (suppressed.has(recipient.email.toLowerCase()) || await unsubscribed(recipient.email,deadline));
    result.push(excluded ? {...recipient,eligible:false,reason:"Unsubscribed or suppressed in Resend"} : recipient);
  }
  return result;
}
export async function listCadenceTemplates(actor: string): Promise<ResendEmailTemplateSummary[]> {
  await assertAdminEmailAccess(actor);
  if (!process.env.RESEND_API_KEY?.trim()) return [];
  const rows=await all<{id:string;name:string;status:string}>("/templates",Date.now()+20000,1000);
  return rows.filter(row=>row.status==="published").map(row=>({id:row.id,name:row.name,status:"published"}));
}
