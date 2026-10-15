"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { SiteSearchResults } from "@/components/site-search-results";
import {
  noResultsText,
  resultCountText,
  showAllText,
  type SiteSearchLabels,
} from "@/lib/site-search-copy";
import {
  SEARCH_MAX_QUERY_CHARACTERS,
  parseSearchQuery,
} from "@/lib/site-search-query";
import type { SiteSearchResponse } from "@/lib/site-search-types";

/** Quiet time after the last keystroke before a search is sent. */
const DEBOUNCE_MS = 250;

/** Where a search stands; `ok` carries the response it produced. */
type SearchState =
  | { readonly phase: "idle" }
  | { readonly phase: "loading"; readonly previous?: SiteSearchResponse }
  | { readonly phase: "ok"; readonly response: SiteSearchResponse; readonly query: string }
  | { readonly phase: "unavailable" };

const IDLE: SearchState = { phase: "idle" };

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

function isGroup(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const group = value as { hits?: unknown; total?: unknown };
  return Array.isArray(group.hits) && typeof group.total === "number";
}

/** The response is ours, but a stale deployment could still answer another shape. */
function isResponse(value: unknown): value is SiteSearchResponse {
  if (typeof value !== "object" || value === null) return false;
  const response = value as { stories?: unknown; services?: unknown };
  return isGroup(response.stories) && isGroup(response.services);
}

async function requestSearch(
  q: string,
  lang: string,
  signal: AbortSignal,
): Promise<SiteSearchResponse> {
  // POST with a JSON body: the term never enters a URL, a history entry, or a
  // referrer (ADR-0033 §5).
  const response = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q, lang }),
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`search answered ${response.status}`);
  const body: unknown = await response.json();
  const results = (body as { results?: unknown } | null)?.results;
  if (!isResponse(results)) throw new Error("search answered an unexpected shape");
  return results;
}

/**
 * The search dialog (ADR-0033): a native modal `<dialog>`, which supplies the
 * focus trap, the inert background, Escape, and the top layer. The header owns
 * `open`; this component owns what is typed and found.
 *
 * It is an upgrade of the results page, not a second search: the form is the
 * page's own GET form, so pressing Enter goes to the results page with the same
 * term, and the dialog only previews the first few hits while typing. Results are
 * announced once, when a search settles, never per keystroke.
 */
export function SiteSearchDialog({
  open,
  onClose,
  onNavigate,
  locale,
  searchHref,
  labels,
}: {
  readonly open: boolean;
  /** The visitor dismissed the dialog (Escape, Close, the veil). */
  readonly onClose: () => void;
  /**
   * The visitor followed a link inside it. The dialog must close, but focus
   * belongs to the page they are going to, not to the header control.
   */
  readonly onNavigate: () => void;
  /** Sent as `lang`, so the server searches this locale's content. */
  readonly locale: string;
  /** The localized results page; the form's action and the "show all" target. */
  readonly searchHref: string;
  readonly labels: SiteSearchLabels;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [state, setState] = useState<SearchState>({ phase: "idle" });
  const inputId = useId();
  const query = parseSearchQuery(value);

  // Open and close the native dialog from `open`, and lock page scroll while it
  // is up: a modal dialog makes the page inert but does not stop it scrolling.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal();
      inputRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [open]);

  // Forget what was typed when the dialog closes. Reset during the next
  // render rather than in an effect, so reopening never flashes the old term.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setValue("");
      setState({ phase: "idle" });
    }
  }

  const text = query.text;
  const hasTokens = query.tokens.length > 0;
  useEffect(() => {
    if (!open || !hasTokens) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState((current) => ({
        phase: "loading",
        ...(current.phase === "ok" ? { previous: current.response } : {}),
      }));
      requestSearch(text, locale, controller.signal).then(
        (response) => setState({ phase: "ok", response, query: text }),
        (error: unknown) => {
          // A superseded or cancelled request is not a failure.
          if (controller.signal.aborted) return;
          // Never log the term; the class of failure is all that is useful.
          console.error(
            "[site-search] request failed",
            error instanceof Error ? error.name : "unknown error",
          );
          setState({ phase: "unavailable" });
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, hasTokens, text, locale]);

  // With nothing usable typed there is no search: whatever finished or was in
  // flight for an earlier term no longer describes the field.
  const current: SearchState = hasTokens ? state : IDLE;

  // What a screen reader hears, once per settled search.
  let announcement = "";
  if (current.phase === "loading") announcement = labels.searching;
  else if (current.phase === "unavailable") announcement = labels.unavailable;
  else if (current.phase === "ok") {
    const found = current.response.stories.total + current.response.services.total;
    announcement =
      found === 0 ? noResultsText(labels, current.query) : resultCountText(labels, found);
  }

  const shown =
    current.phase === "ok"
      ? current.response
      : current.phase === "loading"
        ? current.previous
        : undefined;
  const total = shown === undefined ? 0 : shown.stories.total + shown.services.total;

  return (
    <dialog
      ref={dialogRef}
      aria-label={labels.title}
      // A `close` event also follows the dialog being closed from `open`
      // (a navigation, or the Close button's own state change). Only a close the
      // browser started — Escape — is news to the owner of `open`, and acting on
      // the other kind would pull focus back to the header control after a
      // visitor followed a result.
      onClose={() => {
        if (open) onClose();
      }}
      className="m-0 h-full max-h-none w-full max-w-none bg-transparent p-0 text-foreground backdrop:bg-transparent"
    >
      {/* The panel sits inside a full-viewport veil built from the page's own
          background token, not a raw colour. A click on the veil itself — not on
          anything inside the panel — dismisses; Escape and the Close button are
          the keyboard routes, so the veil is a pointer convenience only. */}
      <div
        className="h-full bg-background/75 backdrop-blur-[2px]"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          className="h-full overflow-y-auto border-b border-border bg-surface shadow-lg sm:h-auto sm:max-h-[85svh]"
          onClick={(event) => {
            // A result and "show all" can lead to a URL that differs only in its
            // query string (from the results page itself), which the header does
            // not see as a navigation, so the dialog closes on the click. A
            // modified click opens elsewhere and leaves it open. `defaultPrevented`
            // is deliberately not consulted: Next's `Link` prevents the default of
            // the very navigation this is reacting to.
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            ) {
              return;
            }
            if (event.target instanceof Element && event.target.closest("a[href]") !== null) {
              onNavigate();
            }
          }}
        >
          <div className="mx-auto max-w-6xl px-4 pb-10 pt-5 sm:px-6 sm:pb-12 sm:pt-8">
            <form
              role="search"
              action={searchHref}
              method="get"
              className="flex items-center gap-3 border-b-2 border-foreground pb-3 sm:gap-4"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="h-6 w-6 shrink-0 sm:h-7 sm:w-7"
              >
                <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M15.5 15.5L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <label htmlFor={inputId} className="sr-only">
                {labels.fieldLabel}
              </label>
              <input
                ref={inputRef}
                id={inputId}
                name="q"
                type="search"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={labels.placeholder}
                maxLength={SEARCH_MAX_QUERY_CHARACTERS}
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-xl font-medium tracking-tight outline-none placeholder:font-normal placeholder:text-muted sm:text-3xl [&::-webkit-search-cancel-button]:hidden"
              />
              <kbd className="hidden rounded-md border border-border-control px-2 py-1 text-[0.8125rem] font-medium text-muted sm:inline">
                Esc
              </kbd>
              <button
                type="button"
                onClick={onClose}
                className={`min-h-11 px-1 text-base font-medium underline underline-offset-4 sm:px-4 ${focusRing}`}
              >
                {labels.close}
              </button>
            </form>

            <p role="status" aria-live="polite" className="sr-only">
              {announcement}
            </p>

            <div className="pt-6 sm:pt-8">
              {!hasTokens ? (
                <p className="text-base text-muted">{labels.prompt}</p>
              ) : current.phase === "unavailable" ? (
                <p className="text-base text-muted">{labels.unavailable}</p>
              ) : shown === undefined ? (
                <p className="text-base text-muted">{labels.searching}</p>
              ) : total === 0 ? (
                <p className="text-lg text-muted">
                  {noResultsText(labels, current.phase === "ok" ? current.query : text)}
                </p>
              ) : (
                <>
                  <SiteSearchResults
                    idPrefix="site-search-dialog"
                    response={shown}
                    tokens={query.tokens}
                    locale={locale}
                    labels={labels}
                  />
                  <Link
                    href={`${searchHref}?${new URLSearchParams({ q: text })}`}
                    // Never prefetched: the URL carries the term, and a prefetch
                    // would send it to the host before the visitor chose to follow
                    // the link — the one thing the POST transport exists to avoid.
                    prefetch={false}
                    className={`mt-8 inline-block border-b border-border-strong pb-0.5 font-medium ${focusRing}`}
                  >
                    {showAllText(labels, text)} →
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}
