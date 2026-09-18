"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useSubmissionGuard } from "@/components/use-submission-guard";
import type { BuiltInLabels } from "@/lib/deployment-config";
import type { PollDefinition, PollDisplayState } from "@/lib/poll";

type Props = { poll: PollDefinition; initial?: PollDisplayState; labels: BuiltInLabels["poll"] };
const endpoint = "/api/poll-vote";

async function readPollState(pollId: string, prepare = false, signal?: AbortSignal): Promise<PollDisplayState> {
  const response = await fetch(`${endpoint}?pollId=${encodeURIComponent(pollId)}${prepare ? "&prepare=1" : ""}`, {
    cache: "no-store", signal, headers: prepare ? { "X-Poll-Prepare": "1" } : undefined,
  });
  if (!response.ok) throw new Error("Poll read failed");
  return response.json() as Promise<PollDisplayState>;
}

export function PollVoteForm({ poll, initial, labels }: Props) {
  const id = useId();
  const guard = useSubmissionGuard();
  const [state, setState] = useState(initial);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string>();
  const [feedbackVersion, setFeedbackVersion] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const outcome = useRef<HTMLParagraphElement>(null);
  const question = state?.question ?? poll.question;
  const options = state?.options ?? poll.options;
  const closed = state?.closed ?? false;
  const voted = acknowledged || state?.alreadyVoted === true;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void readPollState(poll.pollId, false, controller.signal).then((next) => {
      if (active) { setState(next); setReady(true); }
    }).catch(() => { if (active) setError(labels.error); });
    return () => { active = false; controller.abort(); };
  }, [poll.pollId, labels.error]);

  useEffect(() => { if (feedbackVersion > 0) outcome.current?.focus(); }, [feedbackVersion]);

  async function refresh() {
    if (!guard.tryStart()) return;
    setBusy(true); setError(undefined);
    try { setState(await readPollState(poll.pollId)); setReady(true); } catch { setError(labels.error); }
    finally { setBusy(false); guard.finish(); setFeedbackVersion((current) => current + 1); }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) { setError(labels.select); return; }
    if (!guard.tryStart()) return;
    setBusy(true); setError(undefined);
    try {
      // Receive a stable poll-specific cookie before any count can change.
      const current = await readPollState(poll.pollId, true);
      setState(current); setReady(true);
      if (current.closed || current.alreadyVoted) return;
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pollId: poll.pollId, optionId: selected }),
      });
      const payload = await response.json() as { status?: string; reason?: string };
      if (response.ok && (payload.status === "recorded" || payload.status === "already-voted")) {
        // Keep the acknowledgement even if the subsequent result read fails.
        setAcknowledged(true);
      } else if (payload.reason !== "closed") { throw new Error("Vote refused"); }
      setState(await readPollState(poll.pollId));
    } catch { setError(labels.error); }
    finally { setBusy(false); guard.finish(); setFeedbackVersion((current) => current + 1); }
  }

  return (
    <section aria-labelledby={`${id}-question`} className="rounded-md border border-border-control bg-surface p-5">
      <h2 id={`${id}-question`} className="text-xl font-semibold">{question}</h2>
      <p ref={outcome} tabIndex={-1} role="status" className={`mt-3 ${error ? "text-danger" : "text-muted"}`}>
        {error ?? (closed ? labels.closed : voted ? labels.voted : "")}
      </p>
      {!closed && !voted && (
        <form method="post" action={endpoint} onSubmit={submit} className="mt-4 space-y-4">
          <fieldset disabled={!guard.hydrated || !ready || busy}>
            <legend className="sr-only">{question}</legend>
            <div className="space-y-3">
              {options.map((option) => (
                <label key={option.optionId} className="flex cursor-pointer items-start gap-3">
                  <input type="radio" name={`${id}-option`} value={option.optionId} checked={selected === option.optionId} onChange={() => { setSelected(option.optionId); setError(undefined); }} required className="mt-1 accent-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-sm text-muted">{labels.privacy}</p>
          <button type="submit" disabled={!guard.hydrated || !ready || busy} className="rounded-md bg-accent px-5 py-2.5 font-medium text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60">
            {busy ? labels.submitting : error && ready ? labels.retry : labels.submit}
          </button>
          {!guard.hydrated && <p className="text-muted">{labels.javascript}</p>}
        </form>
      )}
      {error && (!ready || voted || closed) && <button type="button" disabled={!guard.hydrated || busy} onClick={() => void refresh()} className="mt-3 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">{labels.retry}</button>}
      {state && (
        <div className="mt-5" aria-label={labels.results}>
          <p className="font-medium">{labels.results}</p>
          <ul className="mt-3 space-y-3">
            {state.options.map((option) => (
              <li key={option.optionId}>
                <div className="flex justify-between gap-4 text-body"><span>{option.label}</span><span className="whitespace-nowrap tabular-nums">{option.percentage.toFixed(1)}% ({option.votes})</span></div>
                <div aria-hidden="true" className="mt-1 h-2 overflow-hidden rounded-md bg-background"><div className="h-full bg-accent" style={{ width: `${option.percentage}%` }} /></div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">{labels.total.replace("{count}", String(state.totalVotes))}</p>
          {state.totalVotes === 0 && <p className="mt-1 text-sm text-muted">{labels.noVotes}</p>}
        </div>
      )}
    </section>
  );
}
