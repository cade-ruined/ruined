import {
  MEMBER_SMS_PRIVACY_HREF,
  MEMBER_SMS_TERMS_HREF,
  MEMBER_SMS_UPDATES_DETAIL,
} from "@/lib/membership/member-communication-preferences-model";

/** Shared by registration and its public, non-submitting review example. */
export default function MemberSmsConsentDisclosure({ id, className }: { id: string; className?: string }) {
  return (
    <p className={className} id={id}>
      {MEMBER_SMS_UPDATES_DETAIL}{" "}
      <a className="underline underline-offset-4" href={MEMBER_SMS_PRIVACY_HREF} rel="noopener noreferrer" target="_blank">Privacy Policy</a>
      {" · "}
      <a className="underline underline-offset-4" href={MEMBER_SMS_TERMS_HREF} rel="noopener noreferrer" target="_blank">SMS Terms</a>
    </p>
  );
}
