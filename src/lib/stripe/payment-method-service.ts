import { reconcileMemberRegistration } from "@/lib/membership/registration-repository";
import "server-only";
import type Stripe from "stripe";
import type { BillingTransaction } from "@/lib/stripe/billing-repository";
import { getBillingDatabase } from "@/lib/stripe/database";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getStripe, getStripeLivemode } from "@/lib/stripe/server";
import { isUuid } from "@/lib/stripe/membership-state";
import {
  PAYMENT_SETUP_CONTEXT, PAYMENT_SETUP_CONSENT_VERSION, PAYMENT_SETUP_CONSENT_TEXT, PAYMENT_SETUP_CONSENTS,
  PaymentMethodSetupError, type MemberPaymentMethodStatus, type SavedPaymentMethodDisplay,
} from "@/lib/stripe/payment-method-model";
import {
  findSetupMember, getSetupAccount, getSetupAttempt, hasPaymentInProgress, lockSetupMember,
  methodWasDetached, recordMethodDetached, type SetupAccount, type SetupAttempt, type SetupContext,
} from "@/lib/stripe/payment-method-repository";

function configuredContext(): SetupContext {
  const accountId = process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID?.trim() ?? "";
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new PaymentMethodSetupError("Saving a payment method is not available yet.", 503);
  return { accountId, livemode: getStripeLivemode() };
}
function requestOptions(deadline?: number): Stripe.RequestOptions {
  if (!deadline) return {};
  const remaining = deadline - Date.now();
  if (remaining < 250) throw new Error("Payment cleanup deadline reached.");
  return { timeout: Math.min(12_000, remaining), maxNetworkRetries: 0 };
}
async function verifiedContext(deadline?: number): Promise<SetupContext> {
  const context = configuredContext();
  const account = await getStripe().accounts.retrieve(null, {}, requestOptions(deadline));
  if (account.id !== context.accountId) throw new PaymentMethodSetupError("Payment setup is temporarily unavailable.", 503);
  return context;
}
function objectId(value: string | { id: string } | null | undefined) { return typeof value === "string" ? value : value?.id ?? null; }
function metadata(attempt: SetupAttempt) {
  return { ruined_context: PAYMENT_SETUP_CONTEXT, ruined_member_id: attempt.member_id,
    ruined_setup_attempt_id: attempt.id, ruined_stripe_account_id: attempt.stripe_account_id,
    ruined_storage_consent: attempt.consent_version };
}
function setupSessionParameters(attempt: SetupAttempt, account: SetupAccount): Stripe.Checkout.SessionCreateParams {
  return { mode: "setup", currency: "usd", customer: account.stripe_customer_id!,
        billing_address_collection: "required", customer_update: { address: "auto", name: "auto" },
        payment_method_data: { allow_redisplay: "always" },
        client_reference_id: attempt.id, metadata: metadata(attempt), setup_intent_data: { metadata: metadata(attempt), description: attempt.consent_text },
        custom_text: { submit: { message: "Save only. No charge or membership starts today. Any future checkout requires your confirmation." } },
        success_url: `${attempt.return_origin}/my/payment-method?setup=returned`, cancel_url: `${attempt.return_origin}/my/payment-method?setup=cancelled`,
        expires_at: Math.floor(new Date(attempt.expires_at).getTime() / 1000), integration_identifier: "ruined_save_payment_rpkmzvqt" };
}
function setupSessionKey(attempt: SetupAttempt) {
  return `ruined-payment-setup-${attempt.stripe_account_id}-${attempt.livemode}-${attempt.id}`;
}
function assertMetadata(value: Stripe.Metadata | null, attempt: SetupAttempt) {
  if (Object.entries(metadata(attempt)).some(([key, expected]) => value?.[key] !== expected)) {
    throw new Error("Payment setup metadata does not match its durable consent.");
  }
}
function assertSession(session: Stripe.Checkout.Session, attempt: SetupAttempt, account: SetupAccount) {
  assertMetadata(session.metadata, attempt);
  if (session.mode !== "setup" || session.livemode !== attempt.livemode || objectId(session.customer) !== account.stripe_customer_id
    || session.client_reference_id !== attempt.id || (attempt.stripe_session_id && attempt.stripe_session_id !== session.id)
    || session.subscription || session.payment_intent) throw new Error("Payment setup session binding is invalid.");
}
function displayFor(method: Stripe.PaymentMethod): SavedPaymentMethodDisplay {
  if (method.card) return { type: method.type, label: `${method.card.brand.toUpperCase()} ending in ${method.card.last4}`,
    brand: method.card.brand, last4: method.card.last4, expMonth: method.card.exp_month, expYear: method.card.exp_year };
  const bank = method.us_bank_account ?? method.sepa_debit;
  return { type: method.type, label: bank?.last4 ? `Bank account ending in ${bank.last4}` : "Saved payment method", ...(bank?.last4 ? { last4: bank.last4 } : {}) };
}
async function currentCustomer(account: SetupAccount, deadline?: number) {
  if (!account.stripe_customer_id) throw new Error("Payment setup customer is missing.");
  const customer = await getStripe().customers.retrieve(account.stripe_customer_id, {}, requestOptions(deadline));
  if (customer.deleted || customer.livemode !== account.livemode) throw new Error("Payment setup customer is unavailable.");
  return customer;
}
async function currentMethod(account: SetupAccount, methodId: string, deadline?: number) {
  const method = await getStripe().paymentMethods.retrieve(methodId, {}, requestOptions(deadline));
  if (method.livemode !== account.livemode || objectId(method.customer) !== account.stripe_customer_id) return null;
  return method;
}
async function assertUnused(tx: BillingTransaction, account: SetupAccount, methodId?: string | null, deadline?: number) {
  if (await hasPaymentInProgress(tx, account.member_id)) throw new PaymentMethodSetupError("A membership checkout or subscription is using your billing details. Manage it through billing.");
  const customer = await currentCustomer(account, deadline);
  const subscriptions = await getStripe().subscriptions.list({ customer: customer.id, status: "all", limit: 100 }, requestOptions(deadline));
  if (subscriptions.has_more || subscriptions.data.some(subscription => !["canceled", "incomplete_expired"].includes(subscription.status))
    || (methodId && objectId(customer.invoice_settings.default_payment_method) === methodId)) {
    throw new PaymentMethodSetupError("This payment method is used for billing. Manage it through billing.");
  }
}

export async function getMemberPaymentMethodStatus(authUserId: string): Promise<MemberPaymentMethodStatus> {
  const config = getPlatformConfiguration();
  const empty: MemberPaymentMethodStatus = { enabled: config.stripePaymentSetupReady, eligible: false, canRemove: false, removalPending: false,
    reason: "Saving a payment method is not available yet.", state: "not_saved", paymentMethod: null };
  if (config.mode !== "connected" || !process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID) return empty;
  const context = configuredContext();
  return getBillingDatabase().begin(async tx => {
    const member = await findSetupMember(tx, authUserId, config.minimumAge);
    if (!member) return { ...empty, reason: "Sign in to an active member account to continue." };
    const account = await getSetupAccount(tx, member.id, context);
    const blocked = await hasPaymentInProgress(tx, member.id);
    const reason = account?.cleanup_pending ? "Your payment method removal is still being confirmed. Try removing it again."
      : member.reason ?? (blocked ? "Your membership checkout is in progress." : config.stripePaymentSetupReady ? null : empty.reason);
    const validConsent = account?.consent_attempt_id && !account.consent_revoked_at;
    const attempt = validConsent ? await getSetupAttempt(tx, account.consent_attempt_id!) : null;
    const saved = Boolean(validConsent && account?.stripe_payment_method_id && attempt?.status === "saved");
    return { enabled: config.stripePaymentSetupReady, eligible: !reason, reason,
      canRemove: !blocked && Boolean(account?.stripe_payment_method_id || account?.cleanup_pending || (attempt && ["creating", "open"].includes(attempt.status))),
      removalPending: Boolean(account?.cleanup_pending),
      state: saved ? "saved" : account?.cleanup_pending || attempt?.status === "creating" || attempt?.status === "open" ? "pending" : "not_saved",
      paymentMethod: saved ? account!.payment_method_display : null };
  });
}

export async function startMemberPaymentMethodSetup(input: {
  authUserId: string; attemptId: string; consentAccepted: unknown; consentVersion: unknown; applicationOrigin: string;
}): Promise<{ url: string }> {
  if (!isUuid(input.attemptId) || input.consentAccepted !== true || typeof input.consentVersion !== "string" || !Object.hasOwn(PAYMENT_SETUP_CONSENTS, input.consentVersion)) {
    throw new PaymentMethodSetupError("Confirm that you want to save a payment method before continuing.", 400);
  }
  const config = getPlatformConfiguration();
  if (!config.stripePaymentSetupReady) throw new PaymentMethodSetupError("Saving a payment method is not available yet.", 503);
  const context = await verifiedContext();
  const reservation = await getBillingDatabase().begin(async tx => {
    let member = await findSetupMember(tx, input.authUserId, config.minimumAge);
    if (!member) throw new PaymentMethodSetupError("An active member account is required.", 403);
    await lockSetupMember(tx, member.id);
    member = await findSetupMember(tx, input.authUserId, config.minimumAge);
    if (!member || member.reason) throw new PaymentMethodSetupError(member?.reason ?? "Your member account is unavailable.", 403);
    if (await hasPaymentInProgress(tx, member.id)) throw new PaymentMethodSetupError("Finish your existing membership checkout first.");
    await tx`insert into member_payment_method_accounts(member_id,stripe_account_id,livemode)
      values(${member.id}::uuid,${context.accountId},${context.livemode}) on conflict do nothing`;
    const account = (await getSetupAccount(tx, member.id, context))!;
    if (account.cleanup_pending) throw new PaymentMethodSetupError("Finish removing the previous payment method first.");
    if (account.stripe_payment_method_id && !account.consent_revoked_at) throw new PaymentMethodSetupError("Your payment method is already saved.");
    const ownAttempt = await getSetupAttempt(tx, input.attemptId);
    if (ownAttempt && (ownAttempt.member_id !== member.id || ownAttempt.stripe_account_id !== context.accountId || ownAttempt.livemode !== context.livemode
      || !["creating", "open"].includes(ownAttempt.status))) throw new PaymentMethodSetupError("Start a new payment setup attempt.");
    const [pending] = await tx<Array<SetupAttempt>>`select * from member_payment_method_setup_attempts
      where member_id=${member.id}::uuid and stripe_account_id=${context.accountId} and livemode=${context.livemode} and status in ('creating','open')`;
    let attempt = pending ?? ownAttempt;
    // Old clients may resume their durable v1 consent, but cannot create new
    // evidence for obsolete wording. A current client may resume that same
    // attempt without changing its provider idempotency parameters or consent.
    if (input.consentVersion !== PAYMENT_SETUP_CONSENT_VERSION && attempt?.consent_version !== input.consentVersion) {
      throw new PaymentMethodSetupError("Reload this page to review the current card-storage permission.", 400);
    }
    if (!attempt) {
      [attempt] = await tx<Array<SetupAttempt>>`insert into member_payment_method_setup_attempts
        (id,member_id,stripe_account_id,livemode,consent_auth_user_id,consent_version,consent_text,return_origin,expires_at)
        values(${input.attemptId}::uuid,${member.id}::uuid,${context.accountId},${context.livemode},${input.authUserId}::uuid,
          ${PAYMENT_SETUP_CONSENT_VERSION},${PAYMENT_SETUP_CONSENT_TEXT},${input.applicationOrigin},clock_timestamp()+interval '2 hours') returning *`;
      await tx`update member_payment_method_accounts set consent_attempt_id=${attempt.id}::uuid,consent_revoked_at=null,updated_at=clock_timestamp()
        where member_id=${member.id}::uuid and stripe_account_id=${context.accountId} and livemode=${context.livemode}`;
    }
    return { memberId: member.id, attemptId: attempt.id };
  });
  // Commit consent and the exact provider idempotency inputs before network I/O.
  // A timeout after Stripe creates the session must resume the same attempt.
  await getBillingDatabase().begin(async tx => {
    await lockSetupMember(tx, reservation.memberId);
    const member = await findSetupMember(tx, input.authUserId, config.minimumAge);
    if (!member || member.id !== reservation.memberId || member.reason) throw new PaymentMethodSetupError(member?.reason ?? "Your member account is unavailable.", 403);
    let account = (await getSetupAccount(tx, member.id, context))!;
    const attempt = (await getSetupAttempt(tx, reservation.attemptId))!;
    if (account.consent_revoked_at || account.cleanup_pending || account.consent_attempt_id !== attempt.id || !["creating", "open"].includes(attempt.status)) {
      throw new PaymentMethodSetupError("Start a new payment setup attempt.");
    }
    if (await hasPaymentInProgress(tx, member.id)) throw new PaymentMethodSetupError("Finish your existing membership checkout first.");
    if (!account.stripe_customer_id) {
      const customer = member.stripe_customer_id
        ? await getStripe().customers.retrieve(member.stripe_customer_id)
        : await getStripe().customers.create({ email: member.email, metadata: { ruined_context: PAYMENT_SETUP_CONTEXT, ruined_member_id: member.id } },
          { idempotencyKey: `ruined-setup-customer-${context.accountId}-${context.livemode}-${member.id}` });
      if (customer.deleted || customer.livemode !== context.livemode) throw new Error("Payment setup customer mode is invalid.");
      await tx`update member_payment_method_accounts set stripe_customer_id=${customer.id} where member_id=${member.id}::uuid
        and stripe_account_id=${context.accountId} and livemode=${context.livemode}`;
      account = (await getSetupAccount(tx, member.id, context))!;
    }
    await assertUnused(tx, account);
  });
  // Customer ownership must survive a session-create timeout so withdrawal and
  // webhook reconciliation can always find every provider object we created.
  const outcome = await getBillingDatabase().begin(async tx => {
    await lockSetupMember(tx, reservation.memberId);
    const member = await findSetupMember(tx, input.authUserId, config.minimumAge);
    if (!member || member.reason) throw new PaymentMethodSetupError(member?.reason ?? "Your member account is unavailable.", 403);
    const account = (await getSetupAccount(tx, member.id, context))!;
    const attempt = (await getSetupAttempt(tx, reservation.attemptId))!;
    if (account.consent_revoked_at || account.cleanup_pending || account.consent_attempt_id !== attempt.id || !["creating", "open"].includes(attempt.status)) {
      throw new PaymentMethodSetupError("Start a new payment setup attempt.");
    }
    await assertUnused(tx, account);
    const session = attempt.stripe_session_id
      ? await getStripe().checkout.sessions.retrieve(attempt.stripe_session_id)
      : await getStripe().checkout.sessions.create(setupSessionParameters(attempt, account), { idempotencyKey: setupSessionKey(attempt) });
    assertSession(session, attempt, account);
    await tx`update member_payment_method_setup_attempts set stripe_session_id=${session.id},
      status=${session.status === "expired" ? "expired" : "open"},updated_at=clock_timestamp() where id=${attempt.id}::uuid`;
    if (session.status !== "open" || !session.url) return null;
    return { url: session.url };
  });
  if (!outcome) throw new PaymentMethodSetupError("That setup session is finished. Refresh to see its status, or start a new attempt.");
  return outcome;
}

/** The parent webhook verifies the signature and owns event deduplication. */
export async function handlePaymentMethodSetupEvent(tx: BillingTransaction, event: Stripe.Event): Promise<boolean> {
  const object = event.data.object as unknown as { id: string; metadata?: Stripe.Metadata; livemode?: boolean };
  const isSetup = object.metadata?.ruined_context === PAYMENT_SETUP_CONTEXT;
  if (!isSetup && event.type !== "payment_method.detached") return false;
  if (!isSetup && !process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID?.trim()) return false;
  const context = await verifiedContext();
  if (event.livemode !== context.livemode || (event.account && event.account !== context.accountId)) return isSetup;
  if (event.type === "payment_method.detached") {
    const [account] = await tx<Array<SetupAccount>>`select * from member_payment_method_accounts where stripe_account_id=${context.accountId}
      and livemode=${context.livemode} and stripe_payment_method_id=${object.id}`;
    if (account) await lockSetupMember(tx, account.member_id);
    await tx`select pg_advisory_xact_lock(hashtext(${context.accountId}),hashtext(${object.id}))`;
    // Tombstones also cover detach arriving before setup success is recorded.
    await recordMethodDetached(tx, context, object.id);
    return Boolean(account) || isSetup;
  }
  if (!["checkout.session.completed", "checkout.session.expired", "setup_intent.succeeded"].includes(event.type)) return true;
  const attemptId = object.metadata?.ruined_setup_attempt_id;
  if (!isUuid(attemptId)) throw new Error("Payment setup attempt is missing.");
  let attempt = await getSetupAttempt(tx, attemptId!);
  // A provider webhook can beat the request transaction commit. Retry instead of losing it.
  if (!attempt) throw new Error("Payment setup attempt has not been committed yet.");
  await lockSetupMember(tx, attempt.member_id);
  attempt = (await getSetupAttempt(tx, attemptId!))!;
  if (attempt.stripe_account_id !== context.accountId || attempt.livemode !== context.livemode) throw new Error("Payment setup account binding is invalid.");
  assertMetadata(object.metadata ?? null, attempt);
  const account = (await getSetupAccount(tx, attempt.member_id, context))!;
  const sessionId = event.type.startsWith("checkout.session.") ? object.id : attempt.stripe_session_id;
  if (!sessionId) throw new Error("Payment setup session has not been committed yet.");
  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  assertSession(session, attempt, account);
  if (session.status === "expired") {
    if (["creating", "open"].includes(attempt.status)) await tx`update member_payment_method_setup_attempts set status='expired',updated_at=clock_timestamp() where id=${attempt.id}::uuid`;
    return true;
  }
  if (session.status !== "complete") throw new Error("Payment setup completion is still pending.");
  const intentId = objectId(session.setup_intent);
  if (!intentId) throw new Error("Payment setup intent is missing.");
  const intent = await getStripe().setupIntents.retrieve(intentId);
  assertMetadata(intent.metadata, attempt);
  if (intent.livemode !== context.livemode || objectId(intent.customer) !== account.stripe_customer_id
    || (attempt.stripe_setup_intent_id && attempt.stripe_setup_intent_id !== intent.id)
    || (event.type === "setup_intent.succeeded" && object.id !== intent.id)) throw new Error("Payment setup intent binding is invalid.");
  if (intent.status !== "succeeded") throw new Error("Payment setup confirmation is still pending.");
  const methodId = objectId(intent.payment_method);
  if (!methodId) throw new Error("Payment setup method is missing.");
  await tx`select pg_advisory_xact_lock(hashtext(${context.accountId}),hashtext(${methodId}))`;
  const method = await currentMethod(account, methodId);
  if (!method || await methodWasDetached(tx, context, methodId)) {
    if (["creating", "open"].includes(attempt.status)) await tx`update member_payment_method_setup_attempts set status='expired',updated_at=clock_timestamp() where id=${attempt.id}::uuid`;
    return true;
  }
  if (account.consent_revoked_at || attempt.consent_revoked_at || account.consent_attempt_id !== attempt.id || attempt.status === "revoked") {
    // Withdrawal can precede a delayed provider completion. Never re-save it.
    await assertUnused(tx, account, methodId);
    await getStripe().paymentMethods.detach(methodId);
    await recordMethodDetached(tx, context, methodId);
    return true;
  }
  if (attempt.status === "expired") return true;
  if (method.allow_redisplay !== "always") await getStripe().paymentMethods.update(methodId, { allow_redisplay: "always" });
  await tx`update member_payment_method_setup_attempts set status='saved',stripe_session_id=${session.id},stripe_setup_intent_id=${intent.id},updated_at=clock_timestamp()
    where id=${attempt.id}::uuid`;
  await tx`update member_payment_method_accounts set stripe_payment_method_id=${method.id},payment_method_display=${tx.json(displayFor(method))},saved_at=clock_timestamp(),updated_at=clock_timestamp()
    where member_id=${attempt.member_id}::uuid and stripe_account_id=${context.accountId} and livemode=${context.livemode}
      and consent_attempt_id=${attempt.id}::uuid and consent_revoked_at is null`;
  await reconcileMemberRegistration(tx, attempt.member_id);
  return true;
}

// Caller holds the canonical member lock and has already revoked consent.
async function cleanupRevokedAccount(tx: BillingTransaction, account: SetupAccount, context: SetupContext, deadline?: number): Promise<boolean> {
    try {
      const attempts = await tx<Array<SetupAttempt>>`select * from member_payment_method_setup_attempts where member_id=${account.member_id}::uuid
        and stripe_account_id=${context.accountId} and livemode=${context.livemode} and status='revoked'`;
      const methods = new Set<string>(account.stripe_payment_method_id ? [account.stripe_payment_method_id] : []);
      for (const attempt of attempts) {
        let session: Stripe.Checkout.Session | null = null;
        if (attempt.stripe_session_id) {
          session = await getStripe().checkout.sessions.retrieve(attempt.stripe_session_id, {}, requestOptions(deadline));
        } else {
          // The create response may have timed out after Stripe accepted it.
          // Search the bound customer first; never create a fresh session during removal.
          let after: string | undefined;
          do {
            const page = await getStripe().checkout.sessions.list({ customer: account.stripe_customer_id!, limit: 100,
              ...(after ? { starting_after: after } : {}) }, requestOptions(deadline));
            session = page.data.find(item => item.metadata?.ruined_setup_attempt_id === attempt.id && item.metadata?.ruined_context === PAYMENT_SETUP_CONTEXT) ?? null;
            after = !session && page.has_more ? page.data.at(-1)?.id : undefined;
          } while (after);
          if (!session) {
            // A timed-out create may still be running remotely. Keep the queue
            // until its fixed expiry; a late webhook also performs cleanup.
            if (new Date(attempt.expires_at).getTime() > Date.now()) throw new Error("An unconfirmed setup session may still be creating.");
            continue;
          }
          await tx`update member_payment_method_setup_attempts set stripe_session_id=${session.id} where id=${attempt.id}::uuid`;
        }
        assertSession(session, attempt, account);
        if (session.status === "open") session = await getStripe().checkout.sessions.expire(session.id, {}, requestOptions(deadline));
        if (session.status === "complete" && objectId(session.setup_intent)) {
          const intent = await getStripe().setupIntents.retrieve(objectId(session.setup_intent)!, {}, requestOptions(deadline));
          assertMetadata(intent.metadata, attempt);
          if (intent.livemode !== context.livemode || objectId(intent.customer) !== account.stripe_customer_id) throw new Error("Invalid setup cleanup binding.");
          if (objectId(intent.payment_method)) methods.add(objectId(intent.payment_method)!);
        }
      }
      for (const methodId of methods) {
        if (await currentMethod(account, methodId, deadline)) {
          await assertUnused(tx, account, methodId, deadline);
          await getStripe().paymentMethods.detach(methodId, {}, requestOptions(deadline));
        }
        await recordMethodDetached(tx, context, methodId);
      }
      await tx`update member_payment_method_accounts set cleanup_pending=false,updated_at=clock_timestamp()
        where member_id=${account.member_id}::uuid and stripe_account_id=${context.accountId} and livemode=${context.livemode}`;
      return false;
    } catch { return true; }
}

/** Trusted maintenance hook. Retries closed-account cleanup without requiring its deleted login. */
export async function cleanupWithdrawnMemberPaymentMethods(options: { memberId?: string; limit?: number; deadline?: number } = {}): Promise<{ processed: number; pending: number }> {
  const sql = getBillingDatabase();
  const countPending = async () => {
    const [row] = options.memberId
      ? await sql<Array<{ count: number }>>`select count(*)::integer as count from member_payment_method_accounts where member_id=${options.memberId}::uuid and cleanup_pending=true`
      : await sql<Array<{ count: number }>>`select count(*)::integer as count from member_payment_method_accounts where cleanup_pending=true`;
    return row.count;
  };
  if (!process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID?.trim()) return { processed: 0, pending: await countPending() };
  const context = await verifiedContext(options.deadline);
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const accounts = options.memberId
    ? await sql<Array<SetupAccount>>`select * from member_payment_method_accounts where member_id=${options.memberId}::uuid
        and stripe_account_id=${context.accountId} and livemode=${context.livemode} and cleanup_pending=true limit ${limit}`
    : await sql<Array<SetupAccount>>`select * from member_payment_method_accounts where stripe_account_id=${context.accountId}
        and livemode=${context.livemode} and cleanup_pending=true order by updated_at limit ${limit}`;
  let processed = 0;
  for (const candidate of accounts) {
    if (options.deadline && Date.now() + 250 >= options.deadline) break;
    try {
      const failed = await sql.begin(async tx => {
        if (options.deadline) {
          const budget = `${Math.max(1, options.deadline - Date.now())}ms`;
          await tx`select set_config('lock_timeout',${budget},true),set_config('statement_timeout',${budget},true)`;
        }
        await lockSetupMember(tx, candidate.member_id);
        const account = await getSetupAccount(tx, candidate.member_id, context);
        if (!account?.cleanup_pending || !account.consent_revoked_at) return false;
        await assertUnused(tx, account, account.stripe_payment_method_id, options.deadline);
        return cleanupRevokedAccount(tx, account, context, options.deadline);
      });
      if (!failed) processed++;
    } catch { /* The durable queue remains available for the next maintenance run. */ }
  }
  return { processed, pending: await countPending() };
}

export async function withdrawMemberPaymentMethod(authUserId: string): Promise<MemberPaymentMethodStatus> {
  const context = await verifiedContext();
  const config = getPlatformConfiguration();
  const cleanupError = await getBillingDatabase().begin(async tx => {
    const member = await findSetupMember(tx, authUserId, config.minimumAge);
    if (!member) throw new PaymentMethodSetupError("An active member account is required.", 403);
    await lockSetupMember(tx, member.id);
    const account = await getSetupAccount(tx, member.id, context);
    if (!account) return false;
    if (account.stripe_customer_id) await assertUnused(tx, account, account.stripe_payment_method_id);
    await tx`update member_payment_method_accounts set consent_revoked_at=coalesce(consent_revoked_at,clock_timestamp()),cleanup_pending=true,updated_at=clock_timestamp()
      where member_id=${member.id}::uuid and stripe_account_id=${context.accountId} and livemode=${context.livemode}`;
    await tx`update member_payment_method_setup_attempts set consent_revoked_at=coalesce(consent_revoked_at,clock_timestamp()),status='revoked',updated_at=clock_timestamp()
      where member_id=${member.id}::uuid and stripe_account_id=${context.accountId} and livemode=${context.livemode} and status in ('creating','open','saved','revoked')`;
    if (!account.stripe_customer_id) {
      await tx`update member_payment_method_accounts set cleanup_pending=false where member_id=${member.id}::uuid
        and stripe_account_id=${context.accountId} and livemode=${context.livemode}`;
      return false;
    }
    return cleanupRevokedAccount(tx, account, context);

  });
  if (cleanupError) throw new PaymentMethodSetupError("Your permission to save this method has been withdrawn. Removal is still being confirmed; please try again.", 503);
  return getMemberPaymentMethodStatus(authUserId);
}

/** Called only AFTER paid Checkout has durably reserved its separately consented attempt. */
export async function getSavedPaymentMethodForCheckout(memberId: string, checkoutAttemptId: string): Promise<{ customerId: string } | null> {
  return getBillingDatabase().begin(async tx => {
    await lockSetupMember(tx, memberId);
    const [paid] = await tx<Array<{ payment_setup_customer_checked: boolean; payment_setup_customer_id: string | null;
      payment_setup_account_id: string | null; payment_setup_livemode: boolean | null }>>`
      select payment_setup_customer_checked,payment_setup_customer_id,payment_setup_account_id,payment_setup_livemode
      from stripe_checkout_attempts where id=${checkoutAttemptId}::uuid and member_id=${memberId}::uuid and status in ('creating','open') for update`;
    if (!paid) throw new PaymentMethodSetupError("Your membership checkout reservation is unavailable.");
    if (paid.payment_setup_customer_checked && !paid.payment_setup_customer_id) return null;
    const context = process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID?.trim() ? await verifiedContext() : null;
    if (paid.payment_setup_customer_checked) {
      if (!context || paid.payment_setup_account_id !== context.accountId || paid.payment_setup_livemode !== context.livemode) {
        throw new PaymentMethodSetupError("Your checkout belongs to a different payment configuration.");
      }
      // Preserve the customer even if the saved method expired/detached. Stripe
      // can collect a replacement during this separately consented paid Checkout.
      const customer = await getStripe().customers.retrieve(paid.payment_setup_customer_id!);
      if (customer.deleted || customer.livemode !== context.livemode) throw new Error("Reserved Checkout customer is unavailable.");
      return { customerId: customer.id };
    }
    let customerId: string | null = null;
    if (context) {
      const account = await getSetupAccount(tx, memberId, context);
      if (account && !account.consent_revoked_at && !account.cleanup_pending && account.consent_attempt_id && account.stripe_payment_method_id) {
        const attempt = await getSetupAttempt(tx, account.consent_attempt_id);
        if (attempt?.status === "saved" && !attempt.consent_revoked_at && !await methodWasDetached(tx, context, account.stripe_payment_method_id)) {
          const method = await currentMethod(account, account.stripe_payment_method_id);
          const now = new Date();
          const expired = method?.card && (method.card.exp_year < now.getUTCFullYear() ||
            (method.card.exp_year === now.getUTCFullYear() && method.card.exp_month < now.getUTCMonth() + 1));
          if (method && method.allow_redisplay === "always" && !expired) {
            await currentCustomer(account);
            customerId = account.stripe_customer_id;
          }
        }
      }
    }
    await tx`update stripe_checkout_attempts set payment_setup_customer_checked=true,payment_setup_customer_id=${customerId},
      payment_setup_account_id=${context?.accountId ?? null},payment_setup_livemode=${context?.livemode ?? null} where id=${checkoutAttemptId}::uuid`;
    return customerId ? { customerId } : null;
  });
}
