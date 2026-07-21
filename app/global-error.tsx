"use client";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#080605", color: "#e5e0d5" }}>
          <div style={{ textAlign: "center" }}>
            <h1>Ruined could not load.</h1>
            <button type="button" onClick={reset}>Retry</button>
          </div>
        </main>
      </body>
    </html>
  );
}
