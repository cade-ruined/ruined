import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import OperatorEventAudienceTabs from "@/components/platform/OperatorEventAudienceTabs";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import { CommunityEventEditor, CommunityRoster } from "@/components/platform/OperatorCommunityEvents";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { OPERATOR_FIELD_CLASS, OPERATOR_PRIMARY_ACTION_CLASS } from "@/components/platform/operatorStyles";
import { getOperatorPageContext } from "@/lib/platform/page-data";
import { legacyCommunityEventRecords } from "@/lib/events/community-event-model";
import { getCommunityRoster, getOpsCommunityEvents } from "@/lib/events/community-event-repository";
import { publicWebsiteHref } from "@/lib/site";

export const dynamic = "force-dynamic";
export default async function CommunityEventOperationsPage({ params, searchParams }: { params: Promise<{ eventKey: string }>; searchParams: Promise<{ query?: string; page?: string }> }) {
  const { eventKey } = await params;
  const search = await searchParams;
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied" || (context.role && context.role !== "ops_admin")) return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;
  const preview = context.state === "preview";
  let events = preview ? legacyCommunityEventRecords() : null;
  let roster: Awaited<ReturnType<typeof getCommunityRoster>> = { count: 0, page: 1, pageCount: 1, registrations: [] };
  try {
    if (!preview && context.viewer) {
      events = await getOpsCommunityEvents(context.viewer.authUserId);
      roster = await getCommunityRoster(context.viewer.authUserId, eventKey, search.query, Number(search.page || "1"));
    }
  } catch (error) {
    console.error("Community event operations unavailable", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
  const event = events?.find((entry) => entry.eventKey === eventKey);
  if (!event) notFound();
  const rosterHref = (page: number) => `/ops/community/${eventKey}?${new URLSearchParams({ query: search.query ?? "", page: String(page) })}#registrations`;
  return <OperatorPageFrame title={event.title}>
    <OperatorEventAudienceTabs selected="community" canManagePublic />
    <div className="mb-5 flex flex-wrap gap-5 text-sm font-semibold"><Link href="/ops/experiences?view=community">← Public events</Link>{event.publicationState === "published" ? <Link href={publicWebsiteHref(`/community#${eventKey}`)} target="_blank" rel="noopener noreferrer">View on website ↗</Link> : null}<a href="#registrations">Registrations ↓</a></div>
    <CommunityEventEditor key={`${eventKey}:${event.version}`} event={event} preview={preview} />
    <section id="registrations" className="mt-10 scroll-mt-36"><h2 className="ui-heading mb-3 text-2xl">Registrations <span className="text-black/45">{preview ? "" : roster.count}</span></h2>
      {event.registrationMode === "external" ? <p className="mb-4 text-sm text-black/60">This event uses an external provider. Manage its roster, consent, capacity and attendance there.</p> : event.registrationMode === "none" && !roster.count ? <p className="text-sm text-black/60">This listing does not collect registrations.</p> : <p className="mb-4 text-sm text-black/60">Original BYOB registrations and waiver records. Attendance does not change registration, consent or the Google Sheet.</p>}
      {event.registrationMode === "byob" || roster.count > 0 ? <><form className="mb-4 flex flex-wrap gap-3" action={`/ops/community/${eventKey}#registrations`}><input aria-label="Find a registrant" name="query" type="search" defaultValue={search.query} className={`${OPERATOR_FIELD_CLASS} sm:max-w-md`} placeholder="Name or email" /><button className={OPERATOR_PRIMARY_ACTION_CLASS}>Search roster</button></form><CommunityRoster key={`${eventKey}:${search.query ?? ""}:${roster.page}`} eventKey={eventKey} registrations={roster.registrations} preview={preview} /><nav aria-label="Registration pages" className="mt-4 flex gap-5 text-sm">{roster.page > 1 ? <Link href={rosterHref(roster.page - 1)}>← Previous</Link> : null}<span>Page {roster.page} of {roster.pageCount}</span>{roster.page < roster.pageCount ? <Link href={rosterHref(roster.page + 1)}>Next →</Link> : null}</nav></> : null}
    </section>
  </OperatorPageFrame>;
}
