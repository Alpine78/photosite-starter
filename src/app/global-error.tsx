"use client";

/** A root-layout failure has no locale provider. Both fixed languages remain readable. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body>
    <main>
      <section lang="en"><h1>Page unavailable</h1><p>Please try again later.</p></section>
      <section lang="fi"><h2>Sivu ei ole saatavilla</h2><p>Yritä myöhemmin uudelleen.</p></section>
      <button type="button" onClick={reset}><span lang="en">Try again</span> / <span lang="fi">Yritä uudelleen</span></button>
    </main>
  </body></html>;
}
