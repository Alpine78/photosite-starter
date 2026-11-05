"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import type { BuiltInLabels } from "@/lib/deployment-config";
import {
  addKeyword,
  keywordSelectionHref,
  MAX_SELECTED_KEYWORDS,
  removeKeyword,
  type KeywordSuggestion,
} from "@/lib/keyword-selection";

const DEBOUNCE_MS = 200;
const MIN_QUERY_CHARACTERS = 2;
const subscribeNothing = () => () => {};
const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
/** A live region says nothing when its text stays the same, so a repeat differs by one invisible character. */
const nextAnnouncement = (previous: string, text: string) => (previous === text ? `${text}\u00a0` : text);

type RequestState = "idle" | "loading" | "ready" | "failed";

/**
 * Choosing several keywords by typing (AB#74), as an ARIA combobox with a listbox popup. It needs
 * script, so a browser without any does not show it, and the plain links beside it work
 * there. The server renders it so that nothing moves when it hydrates, with the field disabled until
 * then. The address it builds still goes through the server's validation like any other.
 */
export function KeywordSelector({ locale, searchPath, labels }: {
  readonly locale: string;
  readonly searchPath: string;
  readonly labels: BuiltInLabels["search"];
}) {
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const router = useRouter();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<readonly KeywordSuggestion[]>([]);
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<readonly KeywordSuggestion[]>([]);
  const [announcement, setAnnouncement] = useState("");
  /** Asks again after a closed list took its pending request with it. */
  const [retry, setRetry] = useState(0);
  const cancelPending = useRef<() => void>(() => {});

  const usable = [...query.trim()].length >= MIN_QUERY_CHARACTERS;

  useEffect(() => {
    if (!usable) return;
    const controller = new AbortController();
    // A later keystroke cancels this one, so only the term the visitor settled on is sent.
    const timer = setTimeout(async () => {
      setRequestState("loading");
      try {
        const response = await fetch("/api/keyword-suggest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ q: query, lang: locale }),
          signal: controller.signal,
        });
        const body = (await response.json()) as { status?: string; suggestions?: readonly KeywordSuggestion[] };
        if (!response.ok || body.status !== "ok" || !Array.isArray(body.suggestions)) throw new Error("unavailable");
        setSuggestions(body.suggestions);
        setActive(-1);
        setRequestState("ready");
        const count = body.suggestions.length;
        const text = count === 0
          ? labels.keywordSelectorNoMatches
          : (count === 1 ? labels.keywordSelectorMatchesOne : labels.keywordSelectorMatches).replace("{count}", new Intl.NumberFormat(locale).format(count));
        setAnnouncement((previous) => nextAnnouncement(previous, text));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSuggestions([]);
        setRequestState("failed");
        setAnnouncement((previous) => nextAnnouncement(previous, labels.keywordSelectorUnavailable));
      }
    }, DEBOUNCE_MS);
    cancelPending.current = () => {
      clearTimeout(timer);
      controller.abort();
    };
    return () => cancelPending.current();
  }, [query, usable, locale, labels, retry]);

  const announce = (text: string) => setAnnouncement((previous) => nextAnnouncement(previous, text));

  // A list that was dismissed stays dismissed: an answer arriving later must not reopen it over the page.
  const closeList = () => {
    cancelPending.current();
    setOpen(false);
    setActive(-1);
  };

  const choose = (suggestion: KeywordSuggestion) => {
    const result = addKeyword(selected, suggestion);
    setSelected(result.selected);
    if (result.outcome === "added") {
      announce(result.replaced.length === 0
        ? labels.keywordSelectorAdded.replace("{name}", suggestion.title)
        : labels.keywordSelectorReplaced.replace("{name}", suggestion.title).replace("{replaced}", new Intl.ListFormat(locale, { type: "conjunction" }).format(result.replaced.map((entry) => entry.title))));
      setQuery("");
      setSuggestions([]);
      setRequestState("idle");
      closeList();
    } else {
      announce(result.outcome === "limit-reached"
        ? labels.keywordSelectorLimit.replace("{count}", String(MAX_SELECTED_KEYWORDS))
        : labels.keywordSelectorAlreadyCovered.replace("{name}", suggestion.title));
    }
    inputRef.current?.focus();
  };

  const remove = (suggestion: KeywordSuggestion) => {
    setSelected(removeKeyword(selected, suggestion.keywordId));
    announce(labels.keywordSelectorRemoved.replace("{name}", suggestion.title));
    inputRef.current?.focus();
  };

  const showPopup = open && usable && (requestState === "ready" || requestState === "failed");

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Only what the visitor can see: never the previous term's list while a new one is on its way.
    const visible = showPopup ? suggestions : [];
    if (event.key === "ArrowDown" && !open && usable) {
      event.preventDefault();
      setOpen(true);
      // Closing took a pending request with it, so ask again; a finished answer is still held.
      if (requestState === "loading") setRetry((count) => count + 1);
    } else if (event.key === "ArrowDown" && visible.length > 0) {
      event.preventDefault();
      setActive((current) => (current + 1) % visible.length);
    } else if (event.key === "ArrowUp" && visible.length > 0) {
      event.preventDefault();
      setActive((current) => (current <= 0 ? visible.length - 1 : current - 1));
    } else if (event.key === "Enter") {
      // Never submits the page form around it by accident.
      event.preventDefault();
      if (active >= 0 && visible[active] !== undefined) choose(visible[active]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      closeList();
    }
  };

  const activeId = showPopup && active >= 0 && suggestions[active] !== undefined ? `${baseId}-option-${suggestions[active].keywordId}` : undefined;

  return (
    <section aria-labelledby={`${baseId}-heading`} className="mt-12 max-w-2xl [@media(scripting:none)]:hidden">
      <h2 id={`${baseId}-heading`} className="text-2xl font-semibold tracking-tight">{labels.keywordSelectorHeading}</h2>
      <p id={`${baseId}-help`} className="mt-2 text-muted">{labels.keywordSelectorHelp.replace("{count}", String(MAX_SELECTED_KEYWORDS))}</p>

      {selected.length > 0 && (
        <ul aria-label={labels.keywordSelectorSelected} className="mt-4 flex flex-wrap gap-2">
          {selected.map((entry) => (
            <li key={entry.keywordId} className="inline-flex items-center gap-2 rounded-full border border-border-strong px-3 py-1">
              <span>{entry.title}</span>
              <button
                type="button"
                onClick={() => remove(entry)}
                aria-label={labels.keywordSelectorRemove.replace("{name}", entry.title)}
                className={`min-h-6 min-w-6 rounded-full ${focusRing}`}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative mt-4">
        <label htmlFor={`${baseId}-input`} className="block font-medium">{labels.keywordSelectorLabel}</label>
        <input
          ref={inputRef}
          disabled={!hydrated}
          id={`${baseId}-input`}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showPopup && suggestions.length > 0}
          aria-controls={listId}
          aria-describedby={`${baseId}-help`}
          {...(activeId === undefined ? {} : { "aria-activedescendant": activeId })}
          autoComplete="off"
          maxLength={100}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(-1);
            // At once, not after the debounce: the previous term's list must not stay on show or take a key.
            if ([...event.target.value.trim()].length < MIN_QUERY_CHARACTERS) {
              setSuggestions([]);
              setRequestState("idle");
            } else {
              setRequestState("loading");
            }
          }}
          onKeyDown={onKeyDown}
          onBlur={closeList}
          className={`mt-2 min-h-12 w-full rounded-sm border border-border-control bg-surface px-4 text-lg ${focusRing}`}
        />
        <ul
          id={listId}
          role="listbox"
          aria-label={labels.keywordSelectorLabel}
          hidden={!showPopup || suggestions.length === 0}
          className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded-sm border border-border-strong bg-surface"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.keywordId}
              id={`${baseId}-option-${suggestion.keywordId}`}
              role="option"
              aria-selected={index === active}
              // Before the input's blur closes the list.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(suggestion)}
              className={`cursor-pointer px-4 py-2 ${index === active ? "bg-surface-hover" : ""}`}
            >
              {suggestion.title} <span className="text-sm text-muted">{suggestion.categoryTitle}</span>
            </li>
          ))}
        </ul>
        {showPopup && requestState === "ready" && suggestions.length === 0 && <p className="mt-2 text-muted">{labels.keywordSelectorNoMatches}</p>}
        {showPopup && requestState === "failed" && <p className="mt-2 text-danger">{labels.keywordSelectorUnavailable}</p>}
      </div>

      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>

      <button
        type="button"
        disabled={!hydrated || selected.length === 0}
        onClick={() => router.push(keywordSelectionHref(searchPath, selected))}
        className={`mt-4 inline-flex min-h-12 items-center justify-center rounded-full bg-accent px-6 text-base font-medium text-accent-foreground disabled:opacity-60 ${focusRing}`}
      >
        {labels.keywordSelectorShow}
      </button>
    </section>
  );
}
