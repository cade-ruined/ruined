"use client";

export default function CardError({ reset }: { reset: () => void }) {
  return <main style={{ minHeight: "100dvh", background: "#222b22", color: "#e8e3d4", display: "grid", placeContent: "center", gap: 24, padding: 32, textAlign: "center" }}>
    <h1 style={{ fontFamily: '"IvyOra Text", Georgia, serif', fontSize: 42, fontWeight: 400 }}>A moment, please.</h1>
    <p style={{ maxWidth: 340, fontSize: 13, lineHeight: 1.7 }}>This card couldn’t be loaded. Please try again shortly.</p>
    <button type="button" onClick={reset} style={{ minHeight: 44, border: "1px solid #e8e3d45c", padding: 12, fontSize: 12 }}>Try again ↗</button>
  </main>;
}
