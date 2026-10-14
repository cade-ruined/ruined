import type { Metadata } from "next";
import Link from "next/link";
import EditorialPage from "@/components/EditorialPage";
import MemberSmsOptInForm from "@/components/membership/MemberSmsOptInForm";
import { sharingMetadata } from "@/lib/sharing";

const description = "Ruined membership text-message preferences, optional opt-in, terms, and privacy.";
const canonicalUrl = "https://members.theruinedproject.com/membership/text-messages";
const contact = <a className="underline underline-offset-4" href="mailto:connect@theruinedproject.com">connect@theruinedproject.com</a>;

export const metadata: Metadata = {
  title: "Membership texts & SMS terms",
  description,
  alternates: { canonical: canonicalUrl },
  ...sharingMetadata({ title: "Membership texts & SMS terms", description, path: canonicalUrl }),
};

export default function MembershipTextMessagesPage() {
  return <EditorialPage
    eyebrow="Membership texts · October 14, 2026"
    title="Membership texts"
    intro="A separate, optional way to receive Ruined membership updates and call reminders."
    sections={[
      { title: "Save your text preference", body: <>
        <p>This form saves your choice to your Ruined membership account. No purchase is required to save a text preference. You can also choose texts while completing registration.</p>
        <MemberSmsOptInForm />
      </> },
      { title: "SMS Terms", body: <>
        <p>Ruined membership texts cover membership updates and call reminders only. If you opt in, you agree to recurring text messages from Ruined at the mobile number you provide. Message frequency varies with your membership and call schedule. Message and data rates may apply.</p>
        <p>Text-message delivery is being prepared and is not currently enabled. These terms describe the planned program; submitting a preference does not mean that messages have started.</p>
      </> },
      { title: "Your choice", body: <>
        <p>Use the form on this page to enter your mobile number and select the separate text-message checkbox. If prompted, verify your membership email, then select Save text preference. The checkbox starts unchecked. During registration, the same optional checkbox appears under Membership updates and is saved with your details. Email preferences are separate.</p>
        <p>Consent is not a condition of purchase or membership. You can complete registration without selecting text messages. Entering a phone number, accepting membership terms, or choosing email updates does not enroll you in texts. A changed number requires a new text-message choice.</p>
      </> },
      { title: "Stop or get help", body: <>
        <p>Once messaging is available, reply STOP to unsubscribe from membership texts or HELP for help. After a STOP request, you may receive one confirmation of your opt-out; no further membership texts will be sent unless you opt in again.</p>
        <p>Replying START alone does not restore Ruined membership texts. To restart after opting out, contact {contact}. Our support team will review your request and collect fresh text-message consent before messages can resume.</p>
        <p>You can also contact {contact} for help or to change your communication preferences. Security, account, and registration emails are separate from optional membership reminders.</p>
        <p>Delivery depends on your mobile carrier and is not guaranteed. Carriers are not liable for delayed or undelivered messages.</p>
      </> },
      { title: "Privacy", body: <>
        <p>We use your mobile number and text-message choice to provide the messages you requested and keep a record of your consent. We do not sell or share mobile information, SMS opt-in data, or consent with third parties or affiliates for their marketing or promotional purposes.</p>
        <p>We may share information with service providers only as needed to operate and deliver the text-message program, subject to confidentiality and use restrictions. Read our <Link className="underline underline-offset-4" href="/privacy">Privacy Policy</Link>.</p>
      </> },
      { title: "Continue to Ruined", body: <>
        <p>To begin membership registration, follow the membership invitation flow. Text reminders remain optional throughout registration.</p>
        <p><Link className="inline-flex min-h-11 items-center underline underline-offset-4" href="/membership#your-invitation">Begin membership registration ↗</Link></p>
        <p><Link className="inline-flex min-h-11 items-center underline underline-offset-4" href="/my/join">Resume your registration ↗</Link></p>
        <p>Questions about these SMS terms? Contact {contact}.</p>
      </> },
    ]}
  />;
}
