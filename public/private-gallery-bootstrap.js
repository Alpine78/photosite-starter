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
  if (!status) return;

  function say(attribute) {
    var text = status.getAttribute(attribute);
    if (text) status.textContent = text;
  }

  // Read the capability and remove it from the address bar in the same breath.
  // `replaceState` rather than `pushState`: the link with its fragment must not
  // stay reachable through the Back button, and it must not remain on screen to
  // be shoulder-read, screenshotted, or copied out of a shared browser.
  var capability = window.location.hash.slice(1);
  if (capability) {
    try {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    } catch {
      // A browser that refuses the rewrite still gets the exchange below; the
      // link merely stays visible. Failing the whole bootstrap would be worse.
    }
  }

  if (!capability) {
    say("data-invalid");
    return;
  }

  // The public path, not the internal rewrite target: the Proxy owns the
  // mapping, and the browser must only ever address the configured prefix.
  var basePath = window.location.pathname.replace(/\/+$/, "");

  fetch(basePath + "/exchange", {
    method: "POST",
    // The endpoint accepts JSON only, and a JSON POST from another origin needs
    // a CORS preflight this application never answers — that is what makes the
    // content type a real cross-site control rather than a formality.
    headers: { "Content-Type": "application/json" },
    // The response's `Set-Cookie` is the entire point of the request.
    credentials: "same-origin",
    // The capability is in the body, never in the URL, so it cannot reach an
    // access log, a `Referer`, or browser history.
    body: JSON.stringify({ capability: capability }),
  })
    .then(function (response) {
      // Every refusal answers identically by design, so there is exactly one
      // failure message here — there is nothing more specific to say, and
      // inventing a distinction would undo the endpoint's own uniformity.
      say(response.ok ? "data-connected" : "data-invalid");
    })
    .catch(function () {
      say("data-invalid");
    });
})();
