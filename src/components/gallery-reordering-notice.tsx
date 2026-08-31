import { Breadcrumbs, type BreadcrumbStep } from "@/components/breadcrumbs";
import type { BuiltInLabels } from "@/lib/deployment-config";

type GalleryReorderingNoticeProps = {
  readonly labels: BuiltInLabels;
  readonly breadcrumbs: readonly BreadcrumbStep[];
};

/**
 * The accessible state a seeded-random gallery serves while its materialized
 * order is being recomputed after a seed change (AB#129, ADR-0009 2026-08-28
 * amendment). Distinct from the 404 boundary: this is a transient, retryable
 * state — the gallery exists and will be back — so it keeps the breadcrumb
 * ancestry (a keyboard-reachable way back to the parent category) and asks the
 * browser to retry.
 *
 * Known limitation: this renders as **HTTP 200**, not `503 Service Unavailable`
 * with `Retry-After`. An App Router page render cannot set a 503 status without
 * becoming a Route Handler. `generateMetadata` marks the response `noindex`, and
 * the `<meta http-equiv="refresh">` retries client-side, but a crawler or an
 * HTTP cache cannot tell this apart from a normal page by status code alone. A
 * follow-up may route the gallery detail response through a handler for a real
 * 503 (tracked with AB#132's status-code limitation).
 */
export function GalleryReorderingNotice({
  labels,
  breadcrumbs,
}: GalleryReorderingNoticeProps) {
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6">
      {/* Client-side retry — the page recovers on its own once the recompute
          lands and the cache tag is invalidated, with no visitor action. */}
      <meta httpEquiv="refresh" content="120" />
      {breadcrumbs.length > 0 && (
        <Breadcrumbs label={labels.navigation.breadcrumb} steps={breadcrumbs} />
      )}
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          {labels.gallery.reorderingTitle}
        </h1>
        <p className="max-w-prose text-muted">
          {labels.gallery.reorderingBody}
        </p>
      </div>
    </main>
  );
}
