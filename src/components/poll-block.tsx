import { PollVoteForm } from "@/components/poll-vote-form";
import { readPublicPoll } from "@/lib/poll-vote-access";
import type { PollDefinition, PollDisplayState } from "@/lib/poll";
import type { BuiltInLabels } from "@/lib/deployment-config";

/** Server-render public results; cookie-specific state is refreshed after hydration. */
export async function PollBlock({ poll, labels }: { poll: PollDefinition; labels: BuiltInLabels["poll"] }) {
  let initial: PollDisplayState | undefined;
  try { initial = await readPublicPoll(poll.pollId, undefined); } catch { /* The UI offers a fresh read; no invented counts. */ }
  return <PollVoteForm poll={poll} initial={initial} labels={labels} />;
}
