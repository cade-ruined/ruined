import { cadenceOccurrences, isCadenceStage, type CadenceEvent, type CadenceKind, type CadenceStage, type CadenceTrack } from "./member-email-cadence-model";

export type CadenceCopy = { subject: string; heading: string; body: string; callUrl: string; profileUrl: string; preferencesUrl: string };
function singleLine(value: string): string { return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim(); }
function emailSubject(value: string): string {
  if (value.length <= 200) return value;
  let shortened = "";
  for (const character of value) {
    if (shortened.length + character.length > 199) break;
    shortened += character;
  }
  return `${shortened.trimEnd()}…`;
}
function localDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export type CadenceMessage = { subject?: string; message?: string };
export type CadenceMessageDefaults = { subject: string; message: string };
type CadenceMessageInput = { event: CadenceEvent; kind: CadenceKind; track: CadenceTrack; stage: CadenceStage };

/** These editable defaults exclude the required personalized greeting, call details, and account links. */
function cadenceMessageParts(input: CadenceMessageInput): CadenceMessageDefaults & { heading: string } {
  const { event, kind, track, stage } = input;
  const occurrence = cadenceOccurrences(event, kind, track).find(item => item.stage === stage);
  if (!occurrence) throw new Error("This reminder stage is not available for the event.");
  const title = singleLine(event.title);
  const sameDay = localDate(occurrence.dueAt, event.timeZone) === localDate(event.startsAt, event.timeZone);
  // Use a civil-date comparison, not the elapsed offset, when promising "tomorrow".
  const nextDate = new Date(`${localDate(occurrence.dueAt, event.timeZone)}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const tomorrow = nextDate.toISOString().slice(0, 10) === localDate(event.startsAt, event.timeZone);
  let subject: string, prose: string;
  if (stage === "orientation") {
    subject = "What we mean by Foundations.";
    prose = "Every RU/NED Membership starts in the same place.\n\nFoundations.\n\nFour calls. One month.\n\nFoundations isn’t something you complete before Membership begins. It is where your Membership begins.\n\nWe built it to give every person who walks into RU/NED the same starting point before moving into the ongoing rhythm of Membership and Circles.\n\nWhat we ask from you is pretty simple:\n\nShow up. Participate. Be honest. Be willing to do the work.\n\nYou don’t need to have the right answers. You just need to be willing to look at your life honestly and participate in what comes next.";
  } else if (stage === "one_week" || stage === "two_days") {
    const period = stage === "one_week" ? "One week" : "Two days";
    subject = `${period}.`;
    prose = `${period} from now, we start.\n\nThere’s something worth thinking about:\n\nWhat do you want to be different because you decided to do this?\n\nMaybe you already know. Maybe you’re rebuilding something. Starting something. Letting go of something. Maybe you’re somewhere in the middle and haven’t quite figured out what comes next.\n\nYou don’t need a dramatic reason to be here.\n\nEveryone has been RU/NED by something. Usually more than once. And nobody else gets to decide whether your version of hard was hard enough to matter.\n\nWe’re not asking you to arrive with everything figured out.\n\nWe’re asking you to arrive willing.\n\nWe’ll start there.`;
  } else {
    const when = stage === "day_before" ? tomorrow ? "Tomorrow" : "Coming up" : sameDay ? "Today" : "Coming up";
    subject = `${when}: ${title}.`;
    if (kind === "circle") {
      prose = "Your Circle is back together soon.\n\nThese calls are intentionally small, personal, and never recorded. The people in your Circle are showing up for you, and we’re asking you to show up for them.\n\nPlan to be there.";
    } else if (kind === "membership") {
      prose = "We’re back together soon.\n\nRU/NED was built to be participated in, not consumed alone.\n\nThese calls are where we learn together, do the work together, and build the community you joined RU/NED to be part of.\n\nPlan to be in the room. Give yourself the full call and come ready to participate.";
    } else {
      prose = kind === "foundations_01" ? "We’re about to begin.\n\nFind somewhere you can be present. Come ready to do more than listen.\n\nThis is the first of four Foundations calls—and the starting point for every RU/NED Membership." : "Give yourself the full call and come ready to keep doing the work.\n\nBe present. Participate.";
    }
  }
  return { subject: emailSubject(subject), heading: subject, message: prose };
}

export function cadenceMessageDefaults(input: CadenceMessageInput): CadenceMessageDefaults {
  const { subject, message } = cadenceMessageParts(input);
  return { subject, message };
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

export function cadenceCopy(input: CadenceMessageInput & {
  memberName: string; siteUrl: string; message?: CadenceMessage;
}): CadenceCopy {
  const { event } = input;
  const defaults = cadenceMessageParts(input);
  const subject = input.message?.subject ?? defaults.subject;
  const prose = input.message?.message ?? defaults.message;
  const site = new URL(input.siteUrl);
  if (!["https:", "http:"].includes(site.protocol) || site.username || site.password) throw new Error("A valid membership website URL is required.");
  const calendar = new URL("/my/experiences", site);
  calendar.hash = `experience-${encodeURIComponent(event.id)}`;
  const callUrl = calendar.toString(), profileUrl = new URL("/my", site).toString(), preferencesUrl = new URL("/my/account#email-reminders", site).toString();
  const title = singleLine(event.title);
  const name = singleLine(input.memberName);
  const greeting = name ? `${name},` : "Hello,";
  const date = new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(event.startsAt));
  const time = new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const endDate = localDate(event.startsAt, event.timeZone) === localDate(event.endsAt, event.timeZone) ? "" : `${new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone, month: "long", day: "numeric" }).format(new Date(event.endsAt))} · `;
  const details = `${title}\n${date}\n${time.format(new Date(event.startsAt))}–${endDate}${time.format(new Date(event.endsAt))}`;
  return {
    subject: emailSubject(subject), heading: input.message?.subject ?? defaults.heading,
    body: `${greeting}\n\n${prose}\n\n${details}\n\nYour call details and access link are in your calendar:\n${callUrl}\n\nYour profile:\n${profileUrl}\n\nManage your email reminders in your account:\n${preferencesUrl}\n\nAll the love,\nRU/NED`,
    callUrl, profileUrl, preferencesUrl,
  };
}
