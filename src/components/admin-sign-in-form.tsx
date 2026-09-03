"use client";

import { useId, useState } from "react";

/**
 * The administrator sign-in form (ADR-0015 §3).
 *
 * It posts JSON rather than submitting a plain form, because §3 fixes
 * `application/json` only for the login and every mutation — one content type,
 * checked before anything stateful, shared with the endpoints this repository
 * has already reviewed twice. The cost is that signing in needs JavaScript,
 * which is stated on the page rather than left to fail silently. That trade is
 * the opposite of the one the customer gallery makes, and deliberately so: a
 * gallery's continuation link works with no JavaScript at all because a visitor
 * did not choose their browser for this site, while the operator is one person
 * using their own tools.
 *
 * **Every refusal shows one message.** The endpoint answers a throttled attempt
 * and a wrong secret identically, and this component does not try to say more
 * than it was told — there is nothing here that could reintroduce a distinction
 * the boundary removed.
 */
export function AdminSignInForm({
  action,
  headingText,
  secretLabel,
  submitLabel,
  refusedText,
  javascriptRequiredText,
}: {
  readonly action: string;
  readonly headingText: string;
  readonly secretLabel: string;
  readonly submitLabel: string;
  readonly refusedText: string;
  readonly javascriptRequiredText: string;
}) {
  const secretId = useId();
  const [secret, setSecret] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "refused">("idle");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    try {
      const response = await fetch(action, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      if (response.ok) {
        // A full navigation rather than a client-side transition: the session
        // cookie has just been set, and the page must be re-rendered by the
        // server with it.
        window.location.assign(window.location.pathname);
        return;
      }
    } catch {
      // A transport failure and a refusal are shown the same way. The operator's
      // next action is identical either way, and distinguishing them here would
      // be the component inventing detail the endpoint declined to give.
    }
    setSecret("");
    setState("refused");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h2 className="text-lg font-medium text-strong">{headingText}</h2>

      <noscript>
        <p className="text-danger">{javascriptRequiredText}</p>
      </noscript>

      <div className="flex flex-col gap-2">
        <label htmlFor={secretId} className="text-sm text-muted">
          {secretLabel}
        </label>
        <input
          id={secretId}
          name="secret"
          type="password"
          autoComplete="current-password"
          required
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          className="rounded-md border border-border-strong bg-surface px-3 py-2 text-strong"
          {...(state === "refused" ? { "aria-describedby": `${secretId}-error` } : {})}
        />
      </div>

      {state === "refused" ? (
        <p id={`${secretId}-error`} role="alert" className="text-danger">
          {refusedText}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={state === "sending"}
        className="rounded-md border border-border-strong px-4 py-2 text-strong"
      >
        {submitLabel}
      </button>
    </form>
  );
}

/**
 * Sign-out, posting JSON for the same §3 reason the sign-in form does. A plain
 * form post would be a second content type at this boundary, and an exception
 * the record does not make.
 */
export function AdminSignOutButton({
  action,
  label,
}: {
  readonly action: string;
  readonly label: string;
}) {
  const [sending, setSending] = useState(false);

  async function signOut() {
    setSending(true);
    try {
      await fetch(action, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    } catch {
      // Reload regardless: the session is either gone or was never usable, and
      // the server-rendered page is what decides which state to show.
    }
    window.location.assign(window.location.pathname);
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={sending}
      className="rounded-md border border-border-strong px-4 py-2 text-strong"
    >
      {label}
    </button>
  );
}
