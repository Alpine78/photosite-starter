/*
 * The private-gallery link bootstrap (ADR-0014 §3).
 *
 * A gallery link is `/<prefix>/<handle>#<capability>`. The fragment is the
 * capability, and a browser never sends a fragment to a server — that is the
 * whole reason it lives there — so this script is what carries it, once, to the
 * exchange endpoint, in exchange for a session cookie the browser then holds.
 *
 * The private root layout loads this external same-origin file with Next's
 * beforeInteractive strategy, before the router captures location.href.
 * Next's inline startup queue contains only this fixed script path, under
 * ADR-0011's existing unsafe-inline residual. The capability stays in this
 * closure, never in React state, a serialized payload, storage or history state.
 *
 * Written in conservative browser JavaScript with no build step, because
 * nothing under `public/` is compiled.
 */
(function () {
  "use strict";

  var markupReady = false;
  var queuedCapability = "";
  var exchanging = false;
  var connected = false;
  var unsrubbableCaptureUsed = false;

  function say(attribute) {
    // Hydration may replace the original node. Do not keep a detached status.
    var status = document.getElementById("private-gallery-status");
    if (!status) return;
    var text = status.getAttribute(attribute);
    if (text) status.textContent = text;
  }

  // Capture the capability and replace this history entry before doing any
  // status work or network work. A valid session renders no status element, but
  // its original full link must still lose the fragment on every visit.
  function takeCapability() {
    var capability = window.location.hash.slice(1);
    if (!capability) {
      unsrubbableCaptureUsed = false;
      return "";
    }

    try {
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
      unsrubbableCaptureUsed = false;
    } catch {
      // A browser that refuses the rewrite can still exchange the link on the
      // bootstrap document. Do not exchange that unsrubbable entry repeatedly;
      // its fragment can remain visible until a clean navigation succeeds.
      if (unsrubbableCaptureUsed) return "";
      unsrubbableCaptureUsed = true;
    }
    return capability;
  }

  function visitLocation() {
    var capability = takeCapability();
    if (!markupReady) {
      // An empty second event must not erase a credential already captured.
      if (capability) queuedCapability = capability;
      return;
    }
    exchangeCapability(capability);
  }

  function exchangeCapability(capability) {
    if (!document.getElementById("private-gallery-status")) return;

    // Scrub every visit, but keep only one exchange in flight. A deliberate
    // new fragment can retry after refusal; successful navigation is terminal.
    if (exchanging || connected) return;

    if (!capability) {
      // Back/Forward may dispatch both popstate and hashchange. The first
      // handler takes the fragment; the second sees the clean URL and must not
      // replace an in-progress exchange with an invalid-link message.
      say("data-invalid");
      return;
    }

    // The public path, not the internal rewrite target: the Proxy owns the
    // mapping, and the browser only addresses the configured prefix.
    var basePath = window.location.pathname.replace(/\/+$/, "");
    exchanging = true;

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
        connected = true;
        say("data-connected");
        window.location.replace(
          window.location.pathname + window.location.search,
        );
      })
      .catch(function () {
        say("data-invalid");
      })
      .finally(function () {
        exchanging = false;
      });
  }

  function ready() {
    if (markupReady) return;
    // A newer fragment may have arrived before its hashchange was dispatched.
    var capability = takeCapability() || queuedCapability;
    queuedCapability = "";
    markupReady = true;
    exchangeCapability(capability);
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
  // Scrubbing must precede router initialization even when status markup has
  // not been parsed. Only the exchange waits for the complete server document.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready, { once: true });
  } else {
    ready();
  }
})();
