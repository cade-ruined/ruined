import type { Metadata } from "next";
import Link from "next/link";
import EditorialPage from "@/components/EditorialPage";
import MemberSmsOptInExample from "@/components/membership/MemberSmsOptInExample";
import { sharingMetadata } from "@/lib/sharing";

const description = "Ruined membership text-message terms, privacy, and an example of our optional registration opt-in.";
const contact = <a className="underline underline-offset-4" href="mailto:connect@theruinedproject.com">connect@theruinedproject.com</a>;

export const metadata: Metadata = {
  title: "Membership text messages",
  description,
  alternates: { canonical: "/membership/text-messages" },
  ...sharingMetadata({ title: "Membership text messages", description, path: "/membership/text-messages" }),
};

export default function MembershipTextMessagesPage() {
  return <EditorialPage
    eyebrow="SMS terms · October 8, 2026"
    title="Membership text messages."
    intro="A separate, optional way to receive Ruined membership updates and call reminders."
    sections={[
      { title: "The program", body: <>
        <p>Ruined membership texts cover membership updates and call reminders only. If you opt in, you agree to recurring text messages from Ruined at the mobile number you provide. Message frequency varies with your membership and call schedule. Message and data rates may apply.</p>
        <p>Text-message delivery is being prepared and is not currently enabled. These terms describe the planned program; submitting a preference does not mean that messages have started.</p>
      </> },
      { title: "Your choice", body: <>
        <p>During registration, enter your mobile number, then select the separate text-message checkbox under Membership updates and save your details. The checkbox is unchecked for new members. Email preferences are separate.</p>
        <p>Consent is not a condition of purchase or membership. You can complete registration without selecting text messages. Entering a phone number, accepting membership terms, or choosing email updates does not enroll you in texts. A changed number requires a new text-message choice.</p>
      </> },
      { title: "Stop or get help", body: <>
        <p>Once messaging is available, reply STOP to unsubscribe from membership texts or HELP for help. After a STOP request, you may receive one confirmation of your opt-out; no further membership texts will be sent unless you opt in again.</p>
        <p>You can also contact {contact} for help or to change your communication preferences. Security, account, and registration emails are separate from optional membership reminders.</p>
        <p>Delivery depends on your mobile carrier and is not guaranteed. Carriers are not liable for delayed or undelivered messages.</p>
      </> },
      { title: "Privacy", body: <>
        <p>We use your mobile number and text-message choice to provide the messages you requested and keep a record of your consent. We do not sell or share mobile information, SMS opt-in data, or consent with third parties or affiliates for their marketing or promotional purposes.</p>
        <p>We may share information with service providers only as needed to operate and deliver the text-message program, subject to confidentiality and use restrictions. Read our <Link className="underline underline-offset-4" href="/privacy">Privacy Policy</Link>.</p>
      </> },
      { title: "Registration opt-in example", body: <>
        <p>This public example shows the optional email and text choices presented in registration. The text disclosure and policy links are the same ones used in the registration form. The example is interactive, but cannot submit an enrollment.</p>
        <MemberSmsOptInExample />
        <p><a className="inline-flex min-h-11 items-center underline underline-offset-4" href="/assets/membership/registration-sms-opt-in.jpg">View the registration form screenshot ↗</a></p>
        <p>The screenshot shows our registration form in preview mode, with no real member information. Actual registration requires email verification.</p>
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
