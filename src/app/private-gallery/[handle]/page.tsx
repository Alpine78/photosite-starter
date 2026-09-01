import { notFound } from "next/navigation";

import {
  getBuiltInLabels,
  getDeploymentConfig,
} from "@/lib/deployment-config";
import { isPrivateGalleryHandle } from "@/lib/private-gallery-access";

/**
 * The bootstrap document for a private gallery link (ADR-0014 §3).
 *
 * **It looks nothing up.** The capability lives in the URL fragment, which a
 * browser never sends to a server, so this response is reached with no
 * credential at all — and it therefore renders identically for a handle that
 * names a real gallery and one that names nothing. That is the point: the
 * initial `GET` is non-sensitive and "never reveals whether the handle exists".
 * No gallery metadata, no image reference, no customer data appears here.
 *
 * The script that reads the fragment is served as an **external same-origin
 * file**, so it needs no CSP grant beyond `script-src 'self'` and adds no
 * inline-script use to ADR-0011's accepted `'unsafe-inline'` residual.
 */
export const dynamic = "force-dynamic";

export default async function PrivateGalleryBootstrapPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const { privateGallery, localeRoutes } = getDeploymentConfig();

  // A deployment with the feature off serves nothing here at all.
  if (privateGallery.store === "off") notFound();
  // A malformed handle cannot name any gallery, so refusing it reveals nothing.
  if (!isPrivateGalleryHandle(handle)) notFound();

  const labels = getBuiltInLabels(localeRoutes.defaultLocale).privateGallery;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{labels.title}</h1>
      {/*
        The bootstrap script replaces this text once it knows the outcome, and
        it can do so *before* React hydrates. Without this, hydration finds the
        swapped text, calls it a mismatch, and patches the server's "opening"
        wording back over the real state — which is exactly what happened, and
        intermittently, since it turns on whether the exchange resolves before
        or after hydration. `e2e/private-gallery-link.spec.ts` is what caught
        it.
      */}
      <p
        id="private-gallery-status"
        role="status"
        aria-live="polite"
        suppressHydrationWarning
        className="text-body"
        data-opening={labels.opening}
        data-connected={labels.connected}
        data-invalid={labels.invalidLink}
      >
        {labels.opening}
      </p>
      <noscript>
        <p className="text-danger">{labels.javascriptRequired}</p>
      </noscript>
      <script src="/private-gallery-bootstrap.js" defer />
    </main>
  );
}
