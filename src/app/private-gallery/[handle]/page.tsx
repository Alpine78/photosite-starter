import { headers } from "next/headers";
import { notFound } from "next/navigation";

import {
  createCorrelationId,
  logPrivateGalleryViewEvent,
} from "@/lib/contact-log";
import {
  getBuiltInLabels,
  getDeploymentConfig,
} from "@/lib/deployment-config";
import {
  authorizePrivateGalleryView,
  getPrivateGalleryStores,
  isPrivateGalleryHandle,
  type PrivateGallery,
} from "@/lib/private-gallery-access";

/**
 * The one address a private gallery link has, serving two documents (ADR-0014
 * §3, §5 Stage 1).
 *
 * **Without a session** it is the bootstrap document, and that document looks
 * *nothing* up. The capability lives in the URL fragment, which a browser never
 * sends to a server, so this response is reached with no credential at all —
 * and it therefore renders identically for a handle that names a real gallery
 * and one that names nothing. That is the point: the initial `GET` is
 * non-sensitive and "never reveals whether the handle exists".
 *
 * **With a session that currently authorizes this gallery** it is the gallery
 * itself. Authorization is re-derived on *every* request from the cookie and a
 * fresh gallery read — there is no "the page loaded, so it stays loaded" gap,
 * so a revoked link or a closed access window takes effect on the next
 * navigation rather than whenever the session would have run out.
 *
 * Every unauthorized outcome renders the same bootstrap document: no session,
 * an expired one, a superseded capability generation, a session belonging to
 * another gallery, a handle that names nothing. A page that distinguished them
 * would be exactly the existence oracle the exchange endpoint is careful not to
 * be.
 *
 * The script that reads the fragment is served as an **external same-origin
 * file**, so it needs no CSP grant beyond `script-src 'self'` and adds no
 * inline-script use to ADR-0011's accepted `'unsafe-inline'` residual.
 */
export const dynamic = "force-dynamic";

type Labels = ReturnType<typeof getBuiltInLabels>["privateGallery"];

export default async function PrivateGalleryPage({
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
  const gallery = await resolveAuthorizedGallery(handle);

  return gallery === undefined ? (
    <PrivateGalleryBootstrap labels={labels} />
  ) : (
    <PrivateGalleryView
      labels={labels}
      gallery={gallery}
      locale={localeRoutes.defaultLocale}
    />
  );
}

/**
 * The gallery this request is authorized to see, or `undefined`.
 *
 * The raw `Cookie` header is read rather than `cookies()`: the session contract
 * refuses a request carrying two session cookies (a host-only one plus a
 * cookie-tossed `Domain` sibling), and a name-keyed accessor has already
 * silently chosen one by the time it answers.
 *
 * A store this deployment cannot provide is a wiring mistake rather than a
 * visitor state, so it is logged and then treated as "not authorized" — the
 * bootstrap document is a safe answer to every question this page is asked.
 */
async function resolveAuthorizedGallery(
  handle: string,
): Promise<PrivateGallery | undefined> {
  let stores;
  try {
    stores = getPrivateGalleryStores();
  } catch {
    logPrivateGalleryViewEvent({
      correlationId: createCorrelationId(),
      state: "rejected",
      errorClass: "unexpected",
    });
    return undefined;
  }

  const outcome = await authorizePrivateGalleryView(
    { sessionStore: stores.sessionStore, viewStore: stores.viewStore },
    {
      handle,
      cookieHeader: (await headers()).get("cookie"),
      now: new Date(),
    },
  );

  if (!outcome.authorized) {
    if (outcome.failure.logWorthy) {
      logPrivateGalleryViewEvent({
        correlationId: createCorrelationId(),
        state: "rejected",
        errorClass: outcome.failure.reason,
      });
    }
    return undefined;
  }

  return outcome.gallery;
}

/** The credential-free document. It holds no gallery data because it has none. */
function PrivateGalleryBootstrap({ labels }: { labels: Labels }) {
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

/**
 * The authorized view.
 *
 * It renders what the gallery record actually knows today — that it is open,
 * and until when. The photographs are a later slice: they need the private
 * object store and §5 Stage 2's per-asset signed URLs, and neither exists yet.
 * Saying so plainly is deliberate; an empty grid would claim the gallery had
 * been delivered and found to contain nothing.
 *
 * No handle, no session identifier, and no internal gallery id is rendered.
 */
function PrivateGalleryView({
  labels,
  gallery,
  locale,
}: {
  labels: Labels;
  gallery: PrivateGallery;
  locale: string;
}) {
  const expiresAt = gallery.accessExpiresAt;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        {labels.galleryHeading}
      </h1>
      {expiresAt !== undefined && (
        <p className="text-muted">
          <time dateTime={expiresAt.toISOString()}>
            {labels.accessUntil.replace(
              "{date}",
              new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
                expiresAt,
              ),
            )}
          </time>
        </p>
      )}
      <p className="text-body">{labels.deliveryPending}</p>
    </main>
  );
}
