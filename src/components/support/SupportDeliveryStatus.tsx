import { supportDate } from "@/components/support/SupportShared";
import { OPERATOR_BUTTON_CLASS } from "@/components/platform/operatorStyles";
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
  return <details className="operator-bento-card mt-3" open={attention > 0 || undefined}>
    <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Email notifications{attention ? ` · ${attention} need attention` : ` · ${deliveries.length}`}</summary>
    <p className="mt-2 text-xs leading-relaxed text-[color:var(--operator-muted)]">The conversation is saved here even if its email notification fails.</p>
    <button className={`${OPERATOR_BUTTON_CLASS} mt-2`} onClick={onRefresh} type="button">Refresh email status</button>
    <ul className="mt-3 grid max-h-[32rem] gap-3 overflow-y-auto" aria-label="Email notification status">
      {deliveries.map((delivery) => {
        const state = supportDeliveryState(delivery);
        return <li key={delivery.id} data-operator-tone={state.needsReview ? "error" : state.key === "accepted" ? "success" : "wait"} className={`operator-emphasis rounded-none border border-[var(--operator-line)] p-3 text-xs leading-relaxed ${state.needsReview ? "bg-[var(--operator-error)]" : state.key === "accepted" ? "bg-[var(--operator-success)]" : "bg-[var(--operator-wait)]"}`}>
          <p className="font-semibold">{delivery.audience === "operator" ? "To Ruined support" : "To member"}</p>
          <p className="mt-1 font-medium text-[color:var(--operator-ink)]">{state.label}</p>
          <p className="mt-1 text-[color:var(--operator-muted)]">{state.description}</p>
          <p className="mt-2 text-[color:var(--operator-muted)]"><time dateTime={delivery.created_at}>{supportDate(delivery.created_at, true)} MT</time></p>
          {state.canRetry ? <button className={`${OPERATOR_BUTTON_CLASS} mt-2`} disabled={!writable || pending} onClick={() => onRetry(delivery.id)} type="button">Retry unsent email</button> : null}
        </li>;
      })}
    </ul>
  </details>;
}
