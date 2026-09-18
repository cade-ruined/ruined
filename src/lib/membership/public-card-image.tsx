import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";

import { MEMBER_CARD_HEADERS, type PublicMemberCard } from "./public-card-model";

export const PUBLIC_CARD_IMAGE_SIZE = { width: 1200, height: 630 } as const;

function dataUrl(bytes: Buffer, type: string) {
  return `data:${type};base64,${bytes.toString("base64")}`;
}

/** Only immutable, shipped brand assets are cached. No member data is retained. */
let brandAssets: Promise<{ font: Buffer; mark: string; foilMark: string; wordmark: string; paper: string }> | undefined;
function assets() {
  if (!brandAssets) {
    brandAssets = Promise.all([
      readFile(join(process.cwd(), "public/fonts/IvyOraText-Medium.ttf")),
      readFile(join(process.cwd(), "public/ruined-mark.svg")),
      readFile(join(process.cwd(), "public/ruined-wordmark.svg")),
      readFile(join(process.cwd(), "public/membership/design/printers-ink.jpg")),
    ]).then(([font, mark, wordmark, paper]) => ({
      font,
      mark: dataUrl(mark, "image/svg+xml"),
      foilMark: dataUrl(Buffer.from(mark.toString("utf8")
        .replace(/(<svg\b[^>]*>)/, '$1<defs><linearGradient id="memberFoil" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a9c4c6"/><stop offset=".18" stop-color="#e0e2dc"/><stop offset=".34" stop-color="#78abb3"/><stop offset=".5" stop-color="#b7a6ce"/><stop offset=".68" stop-color="#e7e4da"/><stop offset=".84" stop-color="#9abaca"/><stop offset="1" stop-color="#b2c2b7"/></linearGradient></defs>')
        .replaceAll('fill="#fff"', 'fill="url(#memberFoil)"')), "image/svg+xml"),
      wordmark: dataUrl(wordmark, "image/svg+xml"),
      paper: dataUrl(paper, "image/jpeg"),
    })).catch((error: unknown) => {
      brandAssets = undefined;
      throw error;
    });
  }
  return brandAssets;
}

function memberYear(value: string | null) {
  if (!value) return null;
  const year = new Date(value).getUTCFullYear();
  return Number.isFinite(year) ? String(year) : null;
}

function nameSize(name: string, width: number, height: number, maximum: number) {
  // Allow the full chosen name to fit, including names without word separators.
  const units = Array.from(name).reduce((sum, character) => sum + (/[^\u0000-\u024f]/.test(character) || /[WMwm]/.test(character) ? 1 : 0.62), 0);
  return Math.min(maximum, Math.max(13, Math.floor(Math.sqrt(width * height / Math.max(1, units * 1.4)))));
}

/** Renders only the already-approved public projection and trusted portrait bytes. */
export async function renderPublicMemberCardImage(card: PublicMemberCard, portrait: Blob | null): Promise<ArrayBuffer> {
  const brand = await assets();
  // No URL from the profile is fetched. Normalizing owned bytes also prevents
  // SVG/external image references from reaching the image renderer.
  const portraitData = card.avatarUrl && portrait
    ? dataUrl(await sharp(Buffer.from(await portrait.arrayBuffer()), { limitInputPixels: 40_000_000 })
      .rotate().resize(700, 600, { fit: "cover" }).jpeg({ quality: 88 }).toBuffer(), "image/jpeg")
    : null;
  const year = memberYear(card.memberSince);
  const tag = card.memberTag && card.name !== `@${card.memberTag}` ? `@${card.memberTag}` : null;
  const cardNameSize = nameSize(card.name, 274, 86, 33);
  const titleSize = nameSize(card.name, 490, 272, 72);

  const response = new ImageResponse(
    <div style={{
      width: "100%", height: "100%", display: "flex", position: "relative", overflow: "hidden",
      background: "radial-gradient(ellipse at 35% 35%, #30302b 0%, #1c1c1a 48%, #10100f 100%)",
      color: "#eee8d9", fontFamily: "sans-serif",
    }}>
      <div style={{ position: "absolute", left: 150, top: 80, width: 332, height: 466, display: "flex", flexDirection: "column",
        transform: "rotate(-7deg)", borderRadius: 13, background: "#141413", color: "#e5e0d5",
        border: "1px solid #8c8572", boxShadow: "2px 3px 0 rgba(154,140,108,0.3)",
        padding: 17, overflow: "hidden",
      }}>
        {/* The website's ink texture and exact logo geometry. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.paper} width={332} height={466} alt="" style={{ position: "absolute", left: 0, top: 0, width: 332, height: 466, objectFit: "cover", opacity: 0.48 }} />
        <div style={{ position: "absolute", inset: 7, border: "1px solid rgba(229,224,213,0.25)", borderRadius: 8, display: "flex" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 30, marginBottom: 13 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.wordmark} alt="Ruined" width={81} height={24.3} style={{ filter: "invert(0.88)" }} />
          <span style={{ fontSize: 8, letterSpacing: "2px", color: "#b8b3a9" }}>MEMBERSHIP</span>
        </div>
        <div style={{ display: "flex", width: 296, height: tag ? 170 : 192, flexShrink: 0, overflow: "hidden", border: "1px solid #e5e0d533", background: "#20201e", alignItems: "center", justifyContent: "center" }}>
          {portraitData
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={portraitData} alt="" width={296} height={tag ? 170 : 192} style={{ objectFit: "cover" }} />
            : null}
        </div>
        <div style={{ display: "flex", fontFamily: "IvyOra", fontSize: cardNameSize, lineHeight: 1.08, letterSpacing: "-0.6px", marginTop: 14, height: 87, flexShrink: 0, alignItems: "center", wordBreak: "break-word" }}>
          {card.name}
        </div>
        {tag ? <div style={{ display: "flex", height: 22, flexShrink: 0, fontSize: 11, color: "#b8b3a9" }}>{tag}</div> : null}
        <div style={{ display: "flex", flexDirection: "column", width: 220, height: 58, paddingTop: 8, marginTop: "auto", borderTop: "1px solid #e5e0d533", fontSize: 8, letterSpacing: "1.5px", justifyContent: "center", gap: 6, color: "#b8b3a9" }}>
          <span>RUINED MEMBER</span>
          {year ? <span>MEMBER SINCE {year}</span> : null}
        </div>
        {/* Static foil impression for link previews; the live card reacts to its angle. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.foilMark} alt="" width={76 * 283.956 / 400} height={76} style={{ position: "absolute", right: 23, bottom: 26, opacity: 0.94 }} />
      </div>
      <div style={{ position: "absolute", left: 615, top: 103, width: 492, height: 423, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 10, letterSpacing: "3px", color: "#a5ac98" }}>RUINED / MEMBER CARD</div>
        <div style={{ display: "flex", fontFamily: "IvyOra", fontSize: titleSize, lineHeight: 1.04, letterSpacing: "-1.7px", width: "100%", marginTop: 32, wordBreak: "break-word" }}>{card.name}</div>
        {tag ? <div style={{ display: "flex", marginTop: 15, fontSize: 19, color: "#b8b3a9" }}>{tag}</div> : null}
        {year ? <div style={{ display: "flex", marginTop: 28, fontSize: 10, letterSpacing: "2.5px", color: "#a5ac98" }}>MEMBER SINCE {year}</div> : null}
        <div style={{ display: "flex", alignItems: "center", gap: 15, marginTop: "auto", fontSize: 9, letterSpacing: "1.7px", color: "#a5ac98" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.mark} width={14.2} height={20} alt="" />
          <span>THE RUINED PROJECT</span>
        </div>
      </div>
    </div>,
    {
      ...PUBLIC_CARD_IMAGE_SIZE,
      fonts: [{ name: "IvyOra", data: brand.font, style: "normal", weight: 500 }],
      headers: MEMBER_CARD_HEADERS,
    },
  );
  // Materialize before the route's final consent check; never stream an image
  // whose data could have been withdrawn during portrait download/rendering.
  return response.arrayBuffer();
}
