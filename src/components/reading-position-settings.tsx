"use client";

import { useId, useState, useSyncExternalStore } from "react";
import type { BuiltInLabels } from "@/lib/deployment-config";
import { browserReadingStore, READING_SETTINGS_EVENT } from "@/lib/browser-reading-position";
import { READING_DISABLED_KEY, READING_POSITIONS_KEY } from "@/lib/reading-position-store";

function subscribe(change: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key === READING_DISABLED_KEY || event.key === READING_POSITIONS_KEY) change();
  };
  window.addEventListener(READING_SETTINGS_EVENT, change);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(READING_SETTINGS_EVENT, change);
    window.removeEventListener("storage", storage);
  };
}
const snapshot = () => browserReadingStore().isEnabled();
const serverSnapshot = (): null => null;
const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * Visitor controls for the AB#20 reading continuity. The default disclosure
 * serves articles without a contents list; `compact` is the AB#372 footer of
 * the contents list, where the switch sits next to what it remembers.
 */
export function ReadingPositionSettings({ labels, compact = false }: {
  labels: BuiltInLabels["readingPosition"];
  compact?: boolean;
}) {
  const enabled = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [status, setStatus] = useState({ message: "", sequence: 0 });
  const id = useId();
  const changed = (success: boolean, message: string) => {
    window.dispatchEvent(new Event(READING_SETTINGS_EVENT));
    setStatus((previous) => ({ message: success ? message : labels.failure, sequence: previous.sequence + 1 }));
  };
  const statusRegion = (
    <p role="status" aria-live="polite" className="mt-2">
      <span key={status.sequence}>{status.message}</span>
    </p>
  );
  if (compact) {
    return (
      <div className="reading-settings text-sm">
        {enabled !== null ? (
          <>
            <label htmlFor={id} className="reading-settings__switch">
              <span>{labels.remember}</span>
              <input id={id} type="checkbox" checked={enabled} aria-describedby={`${id}-note`}
                onChange={(event) => changed(browserReadingStore().setEnabled(event.target.checked), labels.updated)} />
            </label>
            <p id={`${id}-note`} className="mt-2 text-subtle">
              {labels.note}{" "}
              <button type="button" className={`reading-settings__clear ${focus}`}
                onClick={() => changed(browserReadingStore().clear(), labels.cleared)}>{labels.clear}</button>
            </p>
          </>
        ) : <noscript><p className="text-subtle">{labels.javascript}</p></noscript>}
        <div className="text-subtle">{statusRegion}</div>
      </div>
    );
  }
  return (
    <details className="mt-6 rounded-md border border-border p-3 text-sm text-muted">
      <summary className={`cursor-pointer font-medium text-foreground ${focus}`}>{labels.heading}</summary>
      <p className="mt-3">{labels.description}</p>
      {enabled !== null ? (
        <div className="mt-3 space-y-3">
          <label htmlFor={id} className="flex min-h-11 items-center gap-3">
            <input id={id} type="checkbox" checked={enabled} className={focus}
              onChange={(event) => changed(browserReadingStore().setEnabled(event.target.checked), labels.updated)} />
            {labels.remember}
          </label>
          <button type="button" className={`min-h-11 rounded-sm border border-border-strong px-3 py-2 ${focus}`}
            onClick={() => changed(browserReadingStore().clear(), labels.cleared)}>{labels.clear}</button>
        </div>
      ) : <noscript><p className="mt-3">{labels.javascript}</p></noscript>}
      {statusRegion}
    </details>
  );
}
