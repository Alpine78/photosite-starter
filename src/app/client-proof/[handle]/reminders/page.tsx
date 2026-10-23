import { notFound } from "next/navigation";
import { getRestrictedPageLocale } from "@/lib/restricted-page-locale-request";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { isProofGalleryHandle } from "@/lib/proof-gallery-path";
import { ProofReminderStop } from "@/components/proof-reminder-stop";

export const dynamic = "force-dynamic";

/**
 * The customer's own reminder stop (ADR-0038 amendment 2026-10-23). It reads
 * no gallery at all, so it works while the proofs are paused, expired or
 * replaced and shows nothing of them; opening it changes nothing, and only the
 * explicit button sends the stop with the key from the link's fragment.
 */
export default async function ProofReminderStopPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  if (!isProofGalleryHandle(handle)) notFound();
  const locale = await getRestrictedPageLocale();
  const labels = getBuiltInLabels(locale).proofReminderStop;
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-6 text-2xl">{labels.title}</h1>
      <ProofReminderStop handle={handle} labels={labels} />
    </main>
  );
}
