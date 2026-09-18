import Link from "next/link";

export default function CardNotFound() {
  return <main style={{ minHeight: "100dvh", background: "#222b22", color: "#e8e3d4", display: "grid", placeContent: "center", gap: 24, padding: 32, textAlign: "center" }}><h1 style={{ fontFamily: '"IvyOra Text", Georgia, serif', fontSize: 46, fontWeight: 400 }}>This card is unavailable.</h1><p style={{ fontSize: 13, maxWidth: 340, lineHeight: 1.7 }}>The owner may have turned off sharing, or this link is no longer available.</p><Link href="https://theruinedproject.com" style={{ fontSize: 12, minHeight: 44, padding: 12, textDecoration: "underline", textUnderlineOffset: 4 }}>Visit Ruined ↗</Link></main>;
}
