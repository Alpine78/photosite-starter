"use client";

import { useState } from "react";
import {
  YOUTUBE_EMBED_ALLOW_FEATURES,
  YOUTUBE_NOCOOKIE_ORIGIN,
} from "@/lib/embed-origins";
import type { BuiltInLabels } from "@/lib/deployment-config";

type YoutubeEmbedProps = {
  videoId: string;
  title: string;
  labels: BuiltInLabels["media"];
  watchLabel: BuiltInLabels["actions"]["watchOnYouTube"];
};

/**
 * Privacy-first YouTube embed: shows a plain placeholder until the user
 * explicitly clicks to load. No request is made to YouTube servers until
 * that point — no cookies, no tracking on page load.
 *
 * Uses youtube-nocookie.com for the embed to minimise tracking even after
 * the user opts in.
 */
export function YoutubeEmbed({
  videoId,
  title,
  labels,
  watchLabel,
}: YoutubeEmbedProps) {
  const [loaded, setLoaded] = useState(false);

  if (loaded) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
        <iframe
          src={`${YOUTUBE_NOCOOKIE_ORIGIN}/embed/${videoId}?autoplay=1`}
          title={title}
          allow={YOUTUBE_EMBED_ALLOW_FEATURES.join("; ")}
          allowFullScreen
          className="absolute inset-0 h-full w-full"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-border px-6 py-10 text-center">
      <p className="text-sm text-subtle">{labels.video}</p>
      <p className="font-medium">{title}</p>
      <button
        onClick={() => setLoaded(true)}
        className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span aria-hidden="true">▶</span>
        {watchLabel}
      </button>
      <p className="text-xs text-muted">
        {labels.youtubePrivacyNotice}
      </p>
    </div>
  );
}
