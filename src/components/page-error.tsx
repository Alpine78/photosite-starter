"use client";

import { usePageErrorLabels } from "./page-error-context";

/** Generic copy only: never render the thrown exception, stack or provider data. */
export function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const labels = usePageErrorLabels();
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-5xl flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-2xl font-semibold text-strong">{labels ? labels.title : <><span lang="en">Page unavailable</span> / <span lang="fi">Sivu ei ole saatavilla</span></>}</h1>
      <p className="text-muted">{labels ? labels.message : <><span lang="en">Please try again later.</span> / <span lang="fi">Yritä myöhemmin uudelleen.</span></>}</p>
      <button type="button" onClick={reset} className="self-start rounded-sm border border-border-strong px-4 py-2 text-strong focus-visible:outline-2 focus-visible:outline-focus">
        {labels ? labels.retry : <><span lang="en">Try again</span> / <span lang="fi">Yritä uudelleen</span></>}
      </button>
    </main>
  );
}
