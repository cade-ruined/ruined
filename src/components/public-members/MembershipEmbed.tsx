"use client";

import { useEffect, type ComponentProps, type MouseEvent } from "react";
import { membershipEmbedNavigationMessage, membershipEmbedParentOrigin, type MembershipEmbedMessage } from "@/lib/membership/landing-embed";
import MembershipOverview from "./MembershipOverview";

type Props = Omit<ComponentProps<typeof MembershipOverview>, "invitation" | "onVerified">;

function sendToParent(message: MembershipEmbedMessage) {
  if (window.parent === window) return false;
  const origin = membershipEmbedParentOrigin(document.referrer, process.env.NODE_ENV === "development");
  if (!origin) return false;
  window.parent.postMessage(message, origin);
  return true;
}

export default function MembershipEmbed(props: Props) {
  useEffect(() => {
    sendToParent({ type: "ruined:membership:ready" });
    const onEscape = (event: KeyboardEvent) => {
      // The film owns Escape while its own dialog is open.
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (sendToParent({ type: "ruined:membership:close" })) event.preventDefault();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);

  const continueRegistration = (destination: string) => {
    const message = membershipEmbedNavigationMessage(destination);
    if (!message || message.type !== "ruined:membership:navigate") throw new Error("Open the membership page to continue registration.");
    if (window.parent === window) { window.location.assign(message.path); return; }
    if (!sendToParent(message)) throw new Error("Open the membership page to continue registration.");
  };

  const leaveFrame = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || !(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.hasAttribute("download") || anchor.getAttribute("href")?.startsWith("#")) return;
    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin && destination.origin !== "https://members.theruinedproject.com") return;
    const message = membershipEmbedNavigationMessage(destination.pathname + destination.search + destination.hash);
    if (!message || message.type !== "ruined:membership:navigate") return;
    // Modified clicks still open a full member page rather than a protected route in this frame.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.target === "_blank") {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      return;
    }
    if (window.parent !== window) {
      if (sendToParent(message)) {
        event.preventDefault();
        event.stopPropagation();
      } else {
        // Privacy tools may suppress the referrer. A normal link remains usable.
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
      }
    }
  };

  return <div onClickCapture={leaveFrame}><MembershipOverview {...props} onVerified={continueRegistration} /></div>;
}
