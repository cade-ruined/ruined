"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import styles from "./MemberLearningArticle.module.css";

export default function MemberLibraryVideo({ captionsUrl, poster, src, title }: {
  captionsUrl: string | null;
  poster: string | null;
  src: string;
  title: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  return (
    <>
      <video
        aria-label={title}
        className="h-full w-full bg-black object-contain"
        controls
        onError={() => setFailed(true)}
        onLoadedData={() => setFailed(false)}
        playsInline
        poster={poster ?? undefined}
        preload="metadata"
        ref={video}
        src={src}
      >
        {captionsUrl ? <track default kind="captions" label="English" src={captionsUrl} srcLang="en" /> : null}
        Your browser cannot play this video inline. <a href={src}>Open the recording.</a>
      </video>
      {failed ? (
        <div className={styles.playerError} role="status">
          <p>We couldn’t load the recording.</p>
          <span>Try again, or contact us if it still won’t play.</span>
          <div>
            <button onClick={() => { setFailed(false); video.current?.load(); }} type="button">Try again</button>
            <Link href="/my/support">Get help</Link>
          </div>
        </div>
      ) : null}
    </>
  );
}
