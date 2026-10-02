import { jsonNoStore } from "@/lib/contact-request";
import { getDeploymentConfig } from "@/lib/deployment-config";
import {
  getPrivateGalleryStores,
  isPrivateGalleryHandle,
  mutateAuthorizedPrivateGalleryProofSelection,
  readAuthorizedPrivateGalleryProofPage,
} from "@/lib/private-gallery-access";

/** The development proof API; every real deployment still has its store off. */
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ handle: string }> };

function refused(): Response {
  // One wire response for an unknown handle, missing session, malformed page,
  // unavailable store, or malformed proof state.
  return jsonNoStore({ ok: false }, 403);
}

function pageIndex(request: Request): number | undefined {
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some((key) => key !== "page") || query.getAll("page").length > 1) {
    return undefined;
  }
  const value = query.get("page") ?? "0";
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return undefined;
  const index = Number(value);
  return Number.isSafeInteger(index) ? index : undefined;
}

export async function GET(request: Request, { params }: Context): Promise<Response> {
  if (getDeploymentConfig().privateGallery.store === "off") return refused();
  const { handle } = await params;
  const index = pageIndex(request);
  if (index === undefined || !isPrivateGalleryHandle(handle)) return refused();

  try {
    const stores = getPrivateGalleryStores();
    const view = await readAuthorizedPrivateGalleryProofPage(
      { sessionStore: stores.sessionStore, viewStore: stores.viewStore,
        proofStore: stores.proofStore },
      { handle, cookieHeader: request.headers.get("cookie"), now: new Date(), pageIndex: index },
    );
    return view === undefined ? refused() : jsonNoStore({ ok: true, view }, 200);
  } catch {
    return refused();
  }
}

async function mutate(request: Request, { params }: Context): Promise<Response> {
  if (getDeploymentConfig().privateGallery.store === "off") return refused();
  const { handle } = await params;
  if (!isPrivateGalleryHandle(handle)) return refused();

  try {
    const stores = getPrivateGalleryStores();
    const outcome = await mutateAuthorizedPrivateGalleryProofSelection(
      { sessionStore: stores.sessionStore, viewStore: stores.viewStore,
        proofStore: stores.proofStore, notification: stores.proofNotification() },
      request,
      { handle, clock: () => new Date() },
    );
    if (!outcome.ok) {
      return outcome.reason === "conflict"
        ? jsonNoStore({ ok: false, reason: "conflict" }, 409)
        : refused();
    }
    return jsonNoStore(outcome, 200);
  } catch {
    return refused();
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  return mutate(request, context);
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  return mutate(request, context);
}
