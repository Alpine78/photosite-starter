/*
 * The private-gallery link bootstrap (ADR-0014 §3).
 *
 * A gallery link is `/<prefix>/<handle>#<capability>`. The fragment is the
 * capability, and a browser never sends a fragment to a server — that is the
 * whole reason it lives there — so this script is what carries it, once, to the
 * exchange endpoint, in exchange for a session cookie the browser then holds.
 *
 * It is a plain external same-origin file rather than an inline script or a
 * React component for three reasons:
 *
 * - `script-src 'self'` already allows it, so it adds nothing to ADR-0011's
 *   accepted `'unsafe-inline'` residual;
 * - the bootstrap page is deliberately a document that looks nothing up, so it
 *   has no props to hydrate and no client bundle to justify; and
 * - the capability must never enter React state, a serialized RSC payload, or
 *   any value the framework might persist — here it exists only as a local
 *   variable in one function.
 *
 * Written in conservative browser JavaScript with no build step, because
 * nothing under `public/` is compiled.
 */
(function () {
  "use strict";

  var status = document.getElementById("private-gallery-status");
  var pendingExchanges = 0;

  function say(attribute) {
    if (!status) return;
    var text = status.getAttribute(attribute);
    if (text) status.textContent = text;
  }

  // Capture the capability and replace this history entry before doing any
  // status work or network work. A valid session renders no status element, but
  // its original full link must still lose the fragment on every visit.
  function takeCapability() {
    var capability = window.location.hash.slice(1);
    if (!capability) return "";

    try {
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
    } catch {
      // A browser that refuses the rewrite can still exchange the link on the
      // bootstrap document. Its fragment may remain visible in that browser.
    }
    return capability;
  }

  function visitLocation() {
    var capability = takeCapability();
    if (!status) return;

    if (!capability) {
      // Back/Forward may dispatch both popstate and hashchange. The first
      // handler takes the fragment; the second sees the clean URL and must not
      // replace an in-progress exchange with an invalid-link message.
      if (pendingExchanges === 0) say("data-invalid");
      return;
    }

    // The public path, not the internal rewrite target: the Proxy owns the
    // mapping, and the browser only addresses the configured prefix.
    var basePath = window.location.pathname.replace(/\/+$/, "");
    pendingExchanges += 1;

    fetch(basePath + "/exchange", {
      method: "POST",
      // A JSON POST from another origin needs a CORS preflight this application
      // never answers. The response's Set-Cookie establishes the session.
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      // The capability is in the body, never a URL or browser history entry.
      body: JSON.stringify({ capability: capability }),
    })
      .then(function (response) {
        // Every refusal answers identically by design.
        if (!response.ok) {
          say("data-invalid");
          return;
        }

        // The cookie now authorizes the clean URL. Replace this entry so Back
        // cannot revisit a bootstrap state and POST it again.
        say("data-connected");
        window.location.replace(
          window.location.pathname + window.location.search,
        );
      })
      .catch(function () {
        say("data-invalid");
      })
      .finally(function () {
        pendingExchanges -= 1;
      });
  }

  // Fragment navigation stays within this document, so its script will not
  // execute again. Traversing history can fire both events; takeCapability's
  // immediate rewrite makes only the first one see a credential.
  window.addEventListener("hashchange", visitLocation);
  window.addEventListener("popstate", visitLocation);
  // A bfcache restore does not rerun the script. Scrub any fragment restored
  // with that entry, while leaving an authorized gallery free of exchange POSTs.
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) visitLocation();
  });
  visitLocation();
})();
