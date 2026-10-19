import { CADENCE_KINDS, CADENCE_STAGES, type CadenceStage } from "./member-email-cadence-model";
import { DEFAULT_AUTOMATION_VIEW_OPTIONS, type AutomationFilter, type AutomationSection, type AutomationViewOptions } from "./email-automation-view";
export type AutomationNavigation = {
  section: AutomationSection; query: string; filter: AutomationFilter; options: AutomationViewOptions;
  selection: {scope:"event"|"sequence";id:string;stage?:CadenceStage}|null; eventId?:string;
};
const validId = (value:string|null) => value && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : undefined;
export function normalizeAutomationView(section: AutomationSection, filter: AutomationFilter, options: AutomationViewOptions) {
  return {
    filter: section === "activity" || (section === "upcoming" && ["finished", "cancelled"].includes(filter)) ? "all" as const : filter,
    options: { ...options, schedule: section === "activity" || (section === "upcoming" && options.schedule === "none") ? "all" as const : options.schedule },
  };
}
export function readAutomationNavigation(search:string):AutomationNavigation {
  const p = new URLSearchParams(search);
  const one = <T extends string>(key:string, values:readonly T[], fallback:T):T => values.includes(p.get(key) as T) ? p.get(key) as T : fallback;
  const stage=one("reminder",["all",...CADENCE_STAGES],"all");
  const selectedStage=one("stage",["",...CADENCE_STAGES],"");
  const scope=one("scope",["event","sequence"],"sequence"), id=validId(p.get("automation"));
  const state: AutomationNavigation = {section:one("view",["upcoming","library","activity"],"upcoming"),query:(p.get("q") ?? "").slice(0,300),filter:one("status",["all","active","paused","attention","finished","cancelled"],"all"),
    options:{...DEFAULT_AUTOMATION_VIEW_OPTIONS,kind:one("kind",["all","foundations",...CADENCE_KINDS],"all"),track:one("audience",["members","founder_test","all"],"members"),schedule:one("date",["all","upcoming","week","month","none"],"all"),sort:one("sort",["next","updated","name"],"next"),stage},
    selection:id ? {scope,id,...(selectedStage ? {stage:selectedStage} : {})} : null,eventId:validId(p.get("call"))};
  return {...state,...normalizeAutomationView(state.section,state.filter,state.options)};
}
export function writeAutomationNavigation(search:string, state:AutomationNavigation):string {
  const p = new URLSearchParams(search);
  const set=(key:string,value:string|undefined,fallback="") => value && value!==fallback ? p.set(key,value) : p.delete(key);
  set("view",state.section,"upcoming");set("q",state.query);set("status",state.filter,"all");set("kind",state.options.kind,"all");set("audience",state.options.track,"members");set("date",state.options.schedule,"all");set("sort",state.options.sort,"next");set("reminder",state.options.stage,"all");
  set("scope",state.selection?.scope);set("automation",state.selection?.id);set("stage",state.selection?.stage);set("call",state.selection ? state.eventId : undefined);
  return p.toString();
}
