"use client";
import { useRef, useSyncExternalStore } from "react";
const subscribeToNothing = () => () => {};

/** Shared by message and poll forms: no native submit before hydration, no concurrent submit before React paints. */
export function useSubmissionGuard() {
  const hydrated = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const inFlight = useRef(false);
  return {
    hydrated,
    tryStart() {
      if (!hydrated || inFlight.current) return false;
      inFlight.current = true;
      return true;
    },
    finish() { inFlight.current = false; },
  };
}
