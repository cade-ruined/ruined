import type { Metadata } from "next";
import ContactForm from "@/components/ContactForm";
export const metadata:Metadata={title:"Contact",alternates:{canonical:"/contact"}};
export default function ContactPage(){return <main className="min-h-screen bg-[var(--color-bone)] px-6 pb-24 pt-28 text-[var(--color-faded)] sm:px-10"><div className="mx-auto max-w-5xl"><p className="ui-heading text-sm text-[var(--color-poster)]">The Ruined Project</p><h1 className="display mt-3 text-[clamp(3.5rem,9vw,7rem)] leading-[.86]">Submit something.</h1><p className="mt-5 max-w-xl text-base opacity-65">395 S Main Street · Alpine, Utah 84004<br/>40.4478° N · 111.7783° W<br/>connect@theruinedproject.com</p><div className="mt-10"><ContactForm/></div></div></main>}
