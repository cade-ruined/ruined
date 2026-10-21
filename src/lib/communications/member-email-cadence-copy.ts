import { cadenceOccurrences, isCadenceStage, type CadenceEvent, type CadenceKind, type CadenceStage, type CadenceTrack } from "./member-email-cadence-model";

export type CadenceCopy = { subject: string; heading: string; body: string; callUrl: string; profileUrl: string; preferencesUrl: string };
function singleLine(value: string): string { return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim(); }
function emailSubject(value: string): string {
  if (value.length <= 200) return value;
  let shortened = "";
  for (const character of value) { if (shortened.length + character.length > 199) break; shortened += character; }
  return shortened.trimEnd() + "…";
}
function localDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
export type CadenceMessage = { subject?: string; message?: string };
export type CadenceMessageDefaults = { subject: string; message: string };
type CadenceMessageInput = { event: CadenceEvent; kind: CadenceKind; track: CadenceTrack; stage: CadenceStage };
type MessageParts = CadenceMessageDefaults & { heading: string; intro: string; closing: string; detailsAfter: boolean; join: boolean; named: boolean; when: string };

function clock(event: CadenceEvent, short = false): string {
  const value = new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(event.startsAt));
  if (short) return value.replace(/ [AP]M$/, "");
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone, timeZoneName: "shortGeneric" }).formatToParts(new Date(event.startsAt)).find(part => part.type === "timeZoneName")?.value ?? event.timeZone;
  return value + " " + zone;
}
function dateLabel(event: CadenceEvent, weekday = true): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone, ...(weekday ? { weekday: "long" as const } : {}), month: "long", day: "numeric" }).format(new Date(event.startsAt));
}
function duration(event: CadenceEvent): string { return String(Math.round((Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60_000)); }
function callName(event: CadenceEvent): string { return singleLine(event.callType || event.title); }
function callDetails(event: CadenceEvent, kind: CadenceKind, today: boolean): string {
  const title = kind === "membership" ? "MEMBERSHIP — " + callName(event)
    : kind === "circle" && event.circleName ? singleLine(event.circleName) + " — " + callName(event) : singleLine(event.title);
  const format = new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone, hour: "numeric", minute: "2-digit" });
  const start = format.format(new Date(event.startsAt)), end = format.format(new Date(event.endsAt));
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone, timeZoneName: "shortGeneric" }).formatToParts(new Date(event.startsAt)).find(part => part.type === "timeZoneName")?.value ?? event.timeZone;
  const sameDate = localDate(event.startsAt, event.timeZone) === localDate(event.endsAt, event.timeZone);
  const prefix = sameDate && start.slice(-2) === end.slice(-2) ? start.replace(/ [AP]M$/, "") : start;
  const endDate = sameDate ? "" : new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone, month: "long", day: "numeric" }).format(new Date(event.endsAt)) + " · ";
  return title + "\n" + (today ? "Today · " : dateLabel(event) + "\n") + prefix + "–" + endDate + end + " " + zone;
}

/** Only the main prose is editable. Personalization, actual call details, links,
 * truthful relative-day wording and the approved signature remain generated. */
function cadenceMessageParts(input: CadenceMessageInput): MessageParts {
  const { event, kind, track, stage } = input;
  const occurrence = cadenceOccurrences(event, kind, track).find(item => item.stage === stage);
  if (!occurrence) throw new Error("This reminder stage is not available for the event.");
  const sameDay = localDate(occurrence.dueAt, event.timeZone) === localDate(event.startsAt, event.timeZone);
  const nextDate = new Date(localDate(occurrence.dueAt, event.timeZone) + "T12:00:00Z"); nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const tomorrow = nextDate.toISOString().slice(0, 10) === localDate(event.startsAt, event.timeZone);
  const when = stage === "day_before" ? tomorrow ? "Tomorrow" : "Coming up" : sameDay ? "Today" : "Coming up";
  const title = callName(event), minutes = duration(event), start = clock(event), shortStart = clock(event, true);
  let heading = when + ": " + title + ".", intro = "", message = "", closing = "";
  const detailsAfter = stage === "orientation", join = !["orientation", "one_week", "two_days"].includes(stage);
  let named = true;
  if (stage === "orientation") {
    heading = "What we mean by Foundations.";
    intro = "every RU/NED Membership starts in the same place.";
    message = "Foundations.\n\nFour calls. One month.\n\nFoundations isn’t something you complete before Membership begins. It is where your Membership begins.\n\nWe built it to give every person who walks into RU/NED the same starting point before moving into the ongoing rhythm of Membership and Circles.\n\nSome of the work will happen together during our calls. Some of it will happen through your RU/NED profile between them.\n\nWhat we ask from you is pretty simple:\n\nShow up. Participate. Be honest. Be willing to do the work.\n\nYou don’t need to have the right answers. You don’t need to have the hardest story in the room. And you don’t need to know exactly what you want to change before you get here.\n\nYou just need to be willing to look at your life honestly and participate in what comes next.";
    closing = "We’ll make sure you have everything you need before we begin.";
  } else if (stage === "one_week" || stage === "two_days") {
    const period = stage === "one_week" ? "One week" : "Two days";
    heading = period + "."; intro = period.toLowerCase() + " from today, we start.";
    message = "There’s nothing you need to study before you get here.\n\nBut there is something worth thinking about:\n\nWhat do you want to be different because you decided to do this?\n\nMaybe you already know.\n\nMaybe you’re rebuilding something. Starting something. Letting go of something. Maybe life is good and you know there’s still more you want from yourself. Maybe you’re somewhere in the middle and haven’t quite figured out what comes next.\n\nYou don’t need a dramatic reason to be here.\n\nEveryone has been RU/NED by something. Usually more than once. And nobody else gets to decide whether your version of hard was hard enough to matter.\n\nWe’re not asking you to arrive with everything figured out.\n\nWe’re asking you to arrive willing.\n\nWe’ll start there.";
    closing = period + ".\n\nWe’ll see you " + dateLabel(event, false) + " at " + start + ".";
  } else if (kind === "membership") {
    if (stage === "day_before") {
      intro = tomorrow ? "we’re back together tomorrow." : "we’re back together soon.";
      message = "There’s nothing you need to prepare beforehand. Just come ready to participate.\n\nRU/NED was built to be participated in, not consumed alone.\n\nThese calls are where we learn together, do the work together, and build the community you joined RU/NED to be part of.\n\nPlan to be in the room. Give yourself the full " + minutes + " minutes and come ready to participate.";
      closing = tomorrow ? "We’ll see you tomorrow." : "We’ll see you there.";
    } else {
      named = false; message = "Plan to be in the room for the full " + minutes + " minutes and ready to participate.";
      closing = "We’ll see you at " + shortStart + ".";
    }
  } else if (kind === "circle") {
    const relative = stage === "day_before" ? tomorrow ? "tomorrow" : "soon" : sameDay ? "today" : "soon";
    heading = "Your Circle meets " + relative + ".";
    if (stage === "day_before") {
      intro = "your Circle is back together " + relative + ".";
      message = "RU/NED was built to be participated in, not consumed alone. Your Circle is where that matters most.\n\nThese calls are intentionally small, personal, and never recorded. The people in your Circle are showing up for you, and we're asking you to show up for them.\n\nPlan to be there.";
      closing = tomorrow ? "We’ll see you tomorrow." : "We’ll see you there.";
    } else {
      intro = "your Circle meets " + relative + ".";
      message = "Your call link is also available in your RU/NED profile.\n\nCircle calls are intentionally small and never recorded.\n\nYour people are showing up. Plan to be one of them.";
      closing = "We’ll see you there.";
    }
  } else if (stage === "day_before") {
    const lead = tomorrow ? "tomorrow" : "soon";
    intro = kind === "foundations_01" ? lead + " we begin." : kind === "foundations_02" ? lead + " we keep going."
      : kind === "foundations_03" ? lead + " is " + singleLine(event.title) + "." : lead + " we finish Foundations.";
    if (kind === "foundations_04" && tomorrow && event.timeZone === "America/Denver" && localDate(event.startsAt, event.timeZone) === "2026-11-30") {
      intro += "\n\nAnd yes—tomorrow is Monday. Thanksgiving moved our final call from its usual Thursday.";
    }
    const preparation = "There’s nothing you need to prepare before " + (tomorrow ? "tomorrow" : "the call") + ". Just come ready to participate.";
    const main = kind === "foundations_01" ? "Give yourself the full " + minutes + " minutes. Find somewhere you can be present. And come ready to do more than listen.\n\nThis is the first of four Foundations calls—and the starting point for every RU/NED Membership."
      : kind === "foundations_02" ? "Give yourself the full " + minutes + " minutes and come ready to pick up where we left off."
      : kind === "foundations_03" ? "We’re halfway through Foundations.\n\nGive yourself the full " + minutes + " minutes and come ready to keep doing the work."
      : "Give yourself the full " + minutes + " minutes. This is the last Foundations call before we move into ongoing Membership and Circles.\n\nOne more call. Then we keep going.";
    message = preparation + "\n\n" + main; closing = "We’ll see you at " + start + ".";
  } else {
    intro = kind === "foundations_01" ? (sameDay ? "today we start." : "we start soon.")
      : kind === "foundations_02" ? (sameDay ? "we’re back at it today." : "we’re back at it soon.")
      : kind === "foundations_03" ? singleLine(event.title) + (sameDay ? " is today." : " is coming up.")
      : sameDay ? "today we finish what we started." : "soon we finish what we started.";
    message = kind === "foundations_01" ? "Give yourself the full " + minutes + " minutes and come ready to participate.\n\nShow up. Be present. Be honest.\n\nWe’ll take it from there."
      : kind === "foundations_02" ? "Give yourself the full " + minutes + " minutes and come ready to participate."
      : kind === "foundations_03" ? "Two down. Two to go.\n\nGive yourself the full " + minutes + " minutes. Be present. Participate."
      : "Four calls.\n\nToday is the fourth.\n\nGive yourself the full " + minutes + " minutes and come ready to finish Foundations with us.\n\nThen we get to show you what comes next.";
    if (!sameDay && kind === "foundations_04") message = message.replace("Today is the fourth.", "The next call is the fourth.");
    closing = kind === "foundations_04" ? "We’ll see you at " + start + "." : "See you at " + shortStart + ".";
  }
  return { subject: emailSubject(heading), heading, intro, message, closing, detailsAfter, join, named, when };
}
export function cadenceMessageDefaults(input: CadenceMessageInput): CadenceMessageDefaults {
  const { subject, message } = cadenceMessageParts(input); return { subject, message };
}

/** Plain-text overrides only; required call information is assembled separately and cannot be replaced. */
export function cadenceMessagesValidationError(value: unknown): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Review the reminder messages.";
  for (const [stage, item] of Object.entries(value)) {
    if (!isCadenceStage(stage) || !item || typeof item !== "object" || Array.isArray(item)) return "Choose a valid reminder stage.";
    for (const [key, text] of Object.entries(item)) {
      if (!["subject", "message"].includes(key) || typeof text !== "string" || !text.trim()) return "Add a subject and message, or reset them to their defaults.";
      if (key === "subject" && (text.length > 200 || /[\u0000-\u001f\u007f]/.test(text))) return "Keep the subject to one line of 200 characters or fewer.";
      if (key === "message" && (text.length > 12000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))) return "Keep the message to 12,000 characters or fewer, without control characters.";
      if (/\{\{|\bTBD\b|\[(?:INSERT|ADD|NAME|FIRST NAME|LINK|DATE|TIME|DEADLINE|RECORDING)[^\]]*\]/i.test(text)) return "Finish the reminder text without template placeholders.";
    }
  }
  return null;
}

export function cadenceCopy(input: CadenceMessageInput & { memberName: string; siteUrl: string; message?: CadenceMessage }): CadenceCopy {
  const { event } = input, parts = cadenceMessageParts(input);
  const site = new URL(input.siteUrl);
  if (!["https:", "http:"].includes(site.protocol) || site.username || site.password) throw new Error("A valid membership website URL is required.");
  const calendar = new URL("/my/experiences", site); calendar.hash = "experience-" + encodeURIComponent(event.id);
  const callUrl = calendar.toString(), profileUrl = new URL("/my", site).toString(), preferencesUrl = new URL("/my/account#email-reminders", site).toString();
  const name = singleLine(input.memberName) || "Hello";
  const intro = parts.intro ? (parts.named ? name + ", " : "") + parts.intro : "";
  const details = callDetails(event, input.kind, parts.when === "Today");
  const prose = input.message?.message ?? parts.message;
  const sections = parts.detailsAfter ? [intro, prose, details] : [intro, details, ...(parts.join ? ["JOIN HERE: " + callUrl] : []), prose];
  const signature = (input.kind.startsWith("foundations_") ? "Tyler, Libby, Cade & Mitch\n" : "") + "RU/NED\nAfter the fear.";
  sections.push(parts.closing, signature);
  // Operational account controls stay separate from the approved message and signature.
  const footer = [...(!parts.join ? ["Your call details and access link are in your calendar:\n" + callUrl] : []), "Your profile:\n" + profileUrl, "Manage your email reminders in your account:\n" + preferencesUrl];
  return { subject: emailSubject(input.message?.subject ?? parts.subject), heading: input.message?.subject ?? parts.heading,
    body: sections.filter(Boolean).join("\n\n") + "\n\n" + footer.join("\n\n"), callUrl, profileUrl, preferencesUrl };
}
