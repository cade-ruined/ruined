import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentRegistrationLegalNotice } from "@/lib/membership/registration-legal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Membership Terms | Ruined", robots: { index: false, follow: true } };

export default async function CurrentRegistrationTermsPage() {
  const terms = await getCurrentRegistrationLegalNotice();
  if (terms.state === "required") redirect(terms.agreementHref);
  return <main className="mx-auto min-h-[60vh] max-w-3xl px-6 pb-24 pt-36">
    <h1 className="text-4xl">Membership terms</h1>
    <p className="mt-6">{terms.message}</p>
    <p className="mt-6"><Link className="underline underline-offset-4" href="/privacy">Privacy Policy</Link></p>
    <p className="mt-4"><a className="underline underline-offset-4" href="mailto:connect@theruinedproject.com">Contact Ruined</a></p>
  </main>;
}
