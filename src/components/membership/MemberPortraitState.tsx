"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type PortraitContext = {
  ownerId?: string;
  avatarUrl: string | null | undefined;
  staleAvatarUrls: readonly (string | null)[];
  setAvatarUrl: (avatarUrl: string | null, initialAvatarUrl: string | null) => void;
};
const PortraitContext = createContext<PortraitContext | null>(null);

/** Keeps a successful photo mutation visible when Next restores an older page. */
export default function MemberPortraitState({ children, ownerId }: {
  children: ReactNode;
  ownerId?: string;
}) {
  const [portrait, setPortrait] = useState(() => ({
    scope: { ownerId },
    avatarUrl: undefined as string | null | undefined,
    staleAvatarUrls: [] as (string | null)[],
  }));
  if (portrait.scope.ownerId !== ownerId) {
    // Reset before rendering children, without remounting an unchanged owner’s
    // forms. Each scope also invalidates callbacks from a previous account.
    setPortrait({ scope: { ownerId }, avatarUrl: undefined, staleAvatarUrls: [] });
  }
  const scope = portrait.scope;
  const setAvatarUrl = useCallback((avatarUrl: string | null, initialAvatarUrl: string | null) => {
    if (!scope.ownerId) return;
    setPortrait((current) => current.scope === scope ? {
      ...current,
      avatarUrl,
      staleAvatarUrls: [...new Set([
        ...current.staleAvatarUrls,
        initialAvatarUrl,
        ...(current.avatarUrl === undefined ? [] : [current.avatarUrl]),
      ])],
    } : current);
  }, [scope]);
  const avatarUrl = ownerId && scope.ownerId === ownerId ? portrait.avatarUrl : undefined;
  const staleAvatarUrls = portrait.staleAvatarUrls;
  const value = useMemo(() => ({ ownerId, avatarUrl, staleAvatarUrls, setAvatarUrl }), [ownerId, avatarUrl, staleAvatarUrls, setAvatarUrl]);

  return <PortraitContext.Provider value={value}>{children}</PortraitContext.Provider>;
}

/** No provider means preview/standalone content uses its supplied portrait. */
export function useMemberPortrait(initialAvatarUrl: string | null) {
  const portrait = useContext(PortraitContext);
  const publish = portrait?.setAvatarUrl;
  const setAvatarUrl = useCallback((avatarUrl: string | null) => {
    publish?.(avatarUrl, initialAvatarUrl);
  }, [publish, initialAvatarUrl]);
  // Only replace snapshots known to predate our successful mutation. A new URL
  // received from the server may be a later change from another device.
  const stale = portrait?.staleAvatarUrls.includes(initialAvatarUrl);
  return {
    ownerId: portrait?.ownerId,
    avatarUrl: portrait?.avatarUrl !== undefined && stale ? portrait.avatarUrl : initialAvatarUrl,
    setAvatarUrl,
  };
}
