import "server-only";

import { getApplicationDatabase } from "@/lib/database/server";

/** Called only after getMemberRegistration has resolved the authenticated owner.
 * A failed provider event is a support signal, never evidence of a paid membership.
 * This read cannot retry a charge, accept terms or advance registration. */
export async function memberCheckoutConfirmationNeedsSupport(memberId: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(memberId)) return false;
  const [row] = await getApplicationDatabase()<Array<{ needs_support: boolean }>>`
    select exists(
      select 1 from stripe_webhook_events event
      where event.object_id=attempt.stripe_session_id
        and event.event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded')
        and event.status='failed'
    ) as needs_support
    from stripe_checkout_attempts attempt
    where attempt.member_id=${memberId}::uuid
    order by attempt.created_at desc,attempt.id desc limit 1`;
  return row?.needs_support === true;
}
