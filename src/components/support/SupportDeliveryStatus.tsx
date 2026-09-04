import { supportDate } from "@/components/support/SupportShared";
import { SUPPORT_LINK_CLASS } from "@/components/support/supportStyles";
import { supportDeliveryNeedsReview, supportDeliveryState } from "@/lib/support/delivery-policy";
import type { SupportEmailDelivery } from "@/lib/support/model";

export default function SupportDeliveryStatus({ deliveries, writable, pending, onRetry, onRefresh }: {
  deliveries: SupportEmailDelivery[];
  writable: boolean;
  pending: boolean;
  onRetry: (id: string) => void;
  onRefresh: () => void;
}) {
  const attention = deliveries.filter((delivery) => supportDeliveryNeedsReview(delivery)).length;
  return <details className="mt-6" open={attention > 0 || undefined}>
    <summary className="cursor-pointer text-lg [font-family:var(--font-cadehandy2)]">Email notifications{attention ? ` · ${attention} need attention` : ` · ${deliveries.length}`}</summary>
    <p className="mt-2 text-xs leading-relaxed text-black/60">The conversation is saved here even if its email notification fails.</p>
    <button className={`${SUPPORT_LINK_CLASS} mt-2 text-xs`} onClick={onRefresh} type="button">Refresh email status</button>
    <ul className="mt-3 grid max-h-[32rem] gap-3 overflow-y-auto" aria-label="Email notification status">
      {deliveries.map((delivery) => {
        const state = supportDeliveryState(delivery);
        return <li key={delivery.id} className="rounded-[4px] bg-black/[0.035] p-3 text-xs leading-relaxed">
          <p className="font-semibold">{delivery.audience === "operator" ? "To Ruined support" : "To member"}</p>
          <p className={`mt-1 ${state.needsReview ? "text-[var(--color-poster)]" : "text-black/70"}`}>{state.label}</p>
          <p className="mt-1 text-black/60">{state.description}</p>
          <p className="mt-2 text-black/50"><time dateTime={delivery.created_at}>{supportDate(delivery.created_at, true)} MT</time></p>
          {state.canRetry ? <button className={`${SUPPORT_LINK_CLASS} mt-2`} disabled={!writable || pending} onClick={() => onRetry(delivery.id)} type="button">Retry unsent email</button> : null}
        </li>;
      })}
    </ul>
  </details>;
}
