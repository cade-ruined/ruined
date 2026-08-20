import Image from "next/image";
import Link from "next/link";
import EmailSignupForm from "@/components/EmailSignupForm";

export default function ComingSoonGate({ title, image, source, signup = true }: { title: string; image: string; source: "store" | "artifacts" | "about"; signup?: boolean }) {
  return <main className="relative min-h-[calc(100svh-7.25rem)] overflow-hidden bg-black text-white sm:min-h-[calc(100svh-8rem)]">
    <Image src={image} alt="" fill priority sizes="100vw" className="object-cover opacity-70" />
    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-black/20" />
    <div className="relative mx-auto flex min-h-[calc(100svh-7.25rem)] max-w-[96rem] flex-col justify-end px-5 pb-12 pt-28 sm:min-h-[calc(100svh-8rem)] sm:px-10 sm:pb-16">
      <Link href={`/#${source === "artifacts" ? "work" : source}`} className="ui-heading mb-auto w-fit text-xs text-white/70">← Return to the walk</Link>
      <p className="ui-heading text-sm text-[var(--color-poster)]">Coming soon</p>
      <h1 className="display mt-2 text-[clamp(4rem,12vw,10rem)] leading-[0.8]">{title}</h1>
      {signup && <EmailSignupForm />}
    </div>
  </main>;
}
