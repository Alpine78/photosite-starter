"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { BuiltInLabels } from "@/lib/deployment-config";
import { selectionKeyFromHash } from "@/lib/proof-selection-link";

const subscribeToHash = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
};
type Phase = "idle" | "working" | "stopped" | "unavailable" | "failed" | "rate-limited";

/** One explicit press sends the stop; stopping is idempotent, so a retry after an unclear answer is safe. */
export function ProofReminderStop({ handle, labels }: { handle: string; labels: BuiltInLabels["proofReminderStop"] }) {
  const key = useSyncExternalStore(subscribeToHash, () => selectionKeyFromHash(window.location.hash) ?? "", () => "");
  const [phase, setPhase] = useState<Phase>("idle");
  const inFlight = useRef(false);
  async function stop() {
    if (inFlight.current || !key) return;
    inFlight.current = true; setPhase("working");
    let next: Phase = "failed";
    try {
      const response = await fetch("/api/proof-selection", {
        method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "stop-reminders", handle, key }),
      });
      const body = await response.json() as { status?: unknown };
      next = response.status === 200 && body.status === "stopped" ? "stopped" : response.status === 404 ? "unavailable" : response.status === 429 ? "rate-limited" : "failed";
    } catch { next = "failed"; }
    inFlight.current = false; setPhase(next);
  }
  if (!key) return <p>{labels.incomplete}</p>;
  if (phase === "stopped") return <p role="status">{labels.stopped}</p>;
  if (phase === "unavailable") return <p role="status">{labels.unavailable}</p>;
  return <>
    <p className="mb-6">{labels.explain}</p>
    <button type="button" aria-disabled={phase === "working"} onClick={() => void stop()}
      className="rounded-sm border border-border-strong px-4 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-focus aria-disabled:opacity-60">
      {phase === "working" ? labels.working : labels.confirm}
    </button>
    <p role="status" className="mt-4 text-sm">{phase === "failed" ? labels.failed : phase === "rate-limited" ? labels.rateLimited : ""}</p>
  </>;
}
