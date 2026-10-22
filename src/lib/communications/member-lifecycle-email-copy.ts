import type { LifecycleEmailKey, LifecycleSettings } from "./member-lifecycle-email-model";

/** Approved CADE copy; substitutions are limited to the named fields. */
export const LIFECYCLE_COPY: Record<LifecycleEmailKey, { subject: string; body: string }> = {
  "birthday": {
    "subject": "Happy birthday, (NAME).",
    "body": "(NAME), happy birthday.\n\nWe considered sending you something profound about another trip around the sun.\n\nWe decided against it.\n\nInstead, here's something you'll actually use:\n\nA members-only RU/NED birthday item. On us.\n\nYOUR CODE: [BIRTHDAY CODE + NAME]\n\nIt's good for the next 7 days, because apparently birthdays have expiration dates now.\n\nWe hope today is a good one. Whatever that looks like for you.\n\nHappy birthday from all of us.\n\nTyler, Libby, Cade & Mitch\nRU/NED\nAfter the fear."
  },
  "anniversary": {
    "subject": "A year ago today.",
    "body": "(NAME), a year ago today, you joined RU/NED.\n\nSince then, you've moved through Foundations.\n\nYou've sat in Membership calls.\n\nYou've found your Circle.\n\nYou've done work nobody else could do for you.\n\nAnd hopefully, somewhere in all of that, something moved.\n\nGo back for a minute and think about the person who registered a year ago.\n\nWhat were they trying to figure out?\n\nWhat were they carrying?\n\nWhat did they want to change?\n\nWhat did they have absolutely no idea was coming?\n\nA year is long enough for a lot to happen.\n\nWe're glad you spent part of yours here.\n\nHappy RU/NED anniversary, (NAME).\n\nTyler, Libby, Cade & Mitch\nRU/NED\nAfter the fear."
  },
  "ruined_birthday": {
    "subject": "Apparently it's our birthday.",
    "body": "RU/NED is another year older today.\n\nJuly 30 is the day we call our birthday.\n\nAnd while businesses having birthdays is admittedly a little weird, this one feels worth acknowledging.\n\nBecause RU/NED only exists if people actually show up and participate in it.\n\nYou did.\n\nYou brought your stories, your questions, your work, your ideas, your weirdness, your hard things, your good things, and yourselves into this thing with us.\n\nAnd RU/NED is different because you did.\n\nSo today isn't really about celebrating a company.\n\nIt's about being grateful for the people who made it one.\n\nThanks for being here.\n\nHappy birthday to us, apparently.\n\nTyler, Libby, Cade & Mitch\nRU/NED\nAfter the fear."
  },
  "thanksgiving": {
    "subject": "A quick Thanksgiving heads-up.",
    "body": "(NAME), a quick heads-up before this week gets weird.\n\nFor those celebrating Thanksgiving, happy Thanksgiving.\n\nFor those who aren't, happy Thursday.\n\nEither way, the RU/NED team will be mostly unavailable [DATES] because apparently we also have families and have been informed we're expected to see them.\n\nWe'll be back to normal [DATE].\n\n[INSERT ANY CALL/SCHEDULE CHANGES, IF APPLICABLE.]\n\nIf you need something before then, reach out at connect@theruinedproject.com and we'll do our best to help before we disappear.\n\nEnjoy the holiday, the Thursday, the food, the quiet, the chaos—or whatever the week looks like where you are.\n\nRU/NED\nAfter the fear."
  },
  "christmas": {
    "subject": "Before we disappear for a minute…",
    "body": "(NAME), one quick housekeeping note before the end-of-year chaos fully takes over.\n\nThe RU/NED team will be [CLOSED / OPERATING WITH LIMITED AVAILABILITY] from [DATE] through [DATE] [AI NOTE: DATES NEED TO INCLUDE CHRISTMAS AND NYE DATES. THESE NEED TO ADJUST YEARLY].\n\nWe'll be back [DATE].\n\n[INSERT ANY CALL/SCHEDULE CHANGES.]\n\nIf you're celebrating something this season, we hope it's a good one.\n\nIf you're not, we hope you get some good food, some time with people you like, some time away from people you don't, or at minimum a few days where fewer people send you emails.\n\nIncluding us.\n\nMostly.\n\nWe'll see you on the other side.\n\nTyler, Libby, Cade & Mitch\nRU/NED\nAfter the fear."
  },
  "new_year": {
    "subject": "Still you. New year.",
    "body": "(NAME), happy New Year.\n\nNo “new year, new you” speech from us.\n\nYou're still you.\n\nThat's kind of the point.\n\nA new calendar doesn't erase what happened last year, and it doesn't magically decide what happens next.\n\nYou still get to do that part.\n\nWe're excited to keep doing the work with you.\n\nHere's to another year after the fear.\n\nTyler, Libby, Cade & Mitch\nRU/NED\nAfter the fear."
  },
  "checkin_30": {
    "subject": "You know how this works now.",
    "body": "(NAME), you've been doing this long enough that RU/NED probably doesn't feel completely new anymore.\n\nYou've been in Membership calls.\n\nYou've met your Circle.\n\nYou've done some of the work.\n\nSo this feels like a good time to remind you of something:\n\nRU/NED was built to be participated in, not consumed alone.\n\nThe calls matter.\n\nThe work between them matters.\n\nYour Circle matters.\n\nAnd what you bring into all of those things matters too.\n\nYou don't need to do RU/NED perfectly.\n\nYou do need to use it.\n\nShow up. Do the work. Talk to your people. Ask questions. Say something when you're stuck. Let somebody know when something finally moves.\n\nYou're not new anymore.\n\nYou're in it.\n\nAnd we're glad you're here.\n\nLOVE WHAT WE ARE DOING? LEAVE A REVIEW {LINK} + GET A BADGE\n\nTyler, Libby, Cade & Mitch\nRU/NED\nAfter the fear."
  },
  "checkin_90": {
    "subject": "Okay. How's it actually going?",
    "body": "(NAME), you've been inside RU/NED long enough now to have an actual opinion about it.\n\nSo we want to know:\n\nHow's it actually going?\n\nNot the polite answer.\n\nWhat's working?\n\nWhat's changing?\n\nWhere are you stuck?\n\nIs there something you need that you're not getting?\n\n[COMPLETE THIS VERY SHORT CHECK-IN: LINK]\n\nYou don't need to write us an essay.\n\nUnless you want to. Then apparently we're reading an essay.\n\nWe just want to know how you're doing inside this thing we're asking you to participate in.\n\nRU/NED"
  },
  "checkin_6_month": {
    "subject": "Go look at what you wrote.",
    "body": "(NAME), go back six months.\n\nNot metaphorically. We actually want you to go look.\n\nDuring Foundations, you [SPECIFIC THING THEY COMPLETED — LETTER / TIMELINE / ORIGINAL RESPONSE / ETC.]\n\nOpen it.\n\nRead what you wrote.\n\nThen pay attention to what feels different now.\n\nWhat changed?\n\nWhat didn't?\n\nWhat did you think would matter that doesn't anymore?\n\nWhat matters now that wasn't even on your radar then?\n\nAnd where are you still avoiding the exact same thing?\n\nSix months isn't enough time to become an entirely different person.\n\nGood.\n\nThat was never the assignment.\n\nBut it is enough time to look backward and notice movement you couldn't see while you were in it.\n\nGo look.\n\nThen keep going.\n\nTyler, Libby, Cade & Mitch\nRU/NED\nAfter the fear."
  }
};

export type LifecycleCopy = { subject: string; body: string };

export function getLifecycleEditableTemplate(key: LifecycleEmailKey) {
  const replacements: Record<string,string> = {
    "(NAME)": "{{member_name}}", "{LINK}": "{{review_url}}",
    "[BIRTHDAY CODE + NAME]": "{{birthday_code}}",
    "[COMPLETE THIS VERY SHORT CHECK-IN: LINK]": "COMPLETE THIS VERY SHORT CHECK-IN: {{survey_url}}",
    "[SPECIFIC THING THEY COMPLETED — LETTER / TIMELINE / ORIGINAL RESPONSE / ETC.]": "{{foundations_work}}",
    "[DATES]": "{{closure_details}}", "[DATE]": "{{return_date}}",
    "[INSERT ANY CALL/SCHEDULE CHANGES, IF APPLICABLE.]": "{{schedule_changes}}",
    "[INSERT ANY CALL/SCHEDULE CHANGES.]": "{{schedule_changes}}",
  };
  let {subject,body}=LIFECYCLE_COPY[key];
  if (key === "christmas") body=body.replace("[CLOSED / OPERATING WITH LIMITED AVAILABILITY] from [DATE] through [DATE] [AI NOTE: DATES NEED TO INCLUDE CHRISTMAS AND NYE DATES. THESE NEED TO ADJUST YEARLY]", "{{closure_details}}");
  for (const [token,value] of Object.entries(replacements)) { subject=subject.replaceAll(token,value); body=body.replaceAll(token,value); }
  if (key === "checkin_6_month") body=body.replace("Open it.","Open it.\n\n{{foundations_work_url}}");
  const tokens=Array.from(new Set(["{{member_name}}",...`${subject} ${body}`.matchAll(/\{\{[a-z_]+\}\}/g)].map(value=>typeof value === "string" ? value : value[0])));
  return {subject,body,tokens};
}

export function validateLifecycleCopy(key: LifecycleEmailKey, copy: LifecycleCopy) {
  if (!copy.subject.trim() || copy.subject.length>200 || /[\r\n\x00]/.test(copy.subject)
    || !copy.body.trim() || copy.body.length>20000 || /[\x00<>]/.test(copy.body)) throw new Error("Enter a subject and plain-text email copy within the length limits.");
  const allowed=getLifecycleEditableTemplate(key).tokens;
  const combined=`${copy.subject} ${copy.body}`;
  for (const match of combined.matchAll(/\{\{[^{}]+\}\}/g)) if (!allowed.includes(match[0])) throw new Error(`Unsupported field: ${match[0]}`);
  if (/[{}]|\[[^\]]+\]/.test(combined.replace(/\{\{[a-z_]+\}\}/g,""))) throw new Error("Use only the listed email fields; finish other placeholders before saving.");
}

export function lifecycleEmailCopy(key: LifecycleEmailKey, name: string, settings: LifecycleSettings, siteUrl: string, override?: LifecycleCopy | null) {
  const original=override ?? getLifecycleEditableTemplate(key);
  validateLifecycleCopy(key,original);
  const values: Record<string,string> = {
    member_name:name.trim().split(/\s+/)[0] || "Friend",
    review_url:settings.reviewUrl ?? "", survey_url:settings.surveyUrl ?? "",
    foundations_work:settings.foundationsWorkLabel ?? "",
    foundations_work_url:settings.foundationsWorkPath ? new URL(settings.foundationsWorkPath,siteUrl).toString() : "",
    closure_details:settings.closureDetails ?? "", return_date:settings.returnDate ?? "",
    schedule_changes:settings.scheduleChanges === "None" ? "" : settings.scheduleChanges ?? "",
  };
  const substitute=(text:string)=>text.replace(/\{\{([a-z_]+)\}\}/g,(_,token:string)=> {
    if (!(token in values) || (!values[token] && token!=="schedule_changes")) throw new Error("Complete the email's remaining fields before sending.");
    return values[token];
  });
  const preferencesUrl=new URL("/my/account#email-reminders",siteUrl).toString();
  return {subject:substitute(original.subject),body:`${substitute(original.body)}\n\nManage your membership emails: ${preferencesUrl}`,
    links:[preferencesUrl,settings.reviewUrl,settings.surveyUrl,values.foundations_work_url].filter((link):link is string=>Boolean(link))};
}
