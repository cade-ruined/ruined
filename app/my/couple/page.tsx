import Link from "next/link";
import CoupleMembershipApproval from "@/components/membership/CoupleMembershipApproval";

export const metadata = { title: "Couples membership approval", robots: { index: false, follow: false } };
export default async function CoupleMembershipApprovalPage({ searchParams }: { searchParams: Promise<{ authorization?: string }> }) {
  const { authorization } = await searchParams;
  const id = typeof authorization === "string" && /^[0-9a-f-]{36}$/i.test(authorization) ? authorization : undefined;
  return <main className="mx-auto min-h-[60vh] max-w-2xl px-5 py-16">
    <h1 className="font-[var(--font-display)] text-4xl">Couples membership</h1>
    {id ? <CoupleMembershipApproval authorizationId={id} /> : <p className="mt-6">Open the approval link shared by your partner.</p>}
    <Link className="mt-8 mr-6 inline-flex min-h-11 items-center underline underline-offset-4" href="/my/access">Sign in</Link>
    <Link className="mt-8 inline-flex min-h-11 items-center underline underline-offset-4" href={id ? `/my/activate?coupleAuthorization=${encodeURIComponent(id)}` : "/my/activate"}>Review membership agreement</Link>
  </main>;
}
