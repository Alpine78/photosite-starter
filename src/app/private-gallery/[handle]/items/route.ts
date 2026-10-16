import { PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY as MAX_FILES, PRIVATE_GALLERY_DEFAULT_MAX_PAGE_SIZE as PAGE_SIZE } from "@/lib/private-gallery-limits";
import { jsonNoStore } from "@/lib/contact-request";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { getPrivateGalleryStores, isPrivateGalleryHandle, readAuthorizedPrivateGalleryDeliveryPage } from "@/lib/private-gallery-access";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ handle: string }> };
const refused = () => jsonNoStore({ ok: false }, 403);

export async function GET(request: Request, { params }: Context): Promise<Response> {
  if (getDeploymentConfig().privateGallery.store === "off") return refused();
  const { handle } = await params;
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some((key) => key !== "page") || query.getAll("page").length > 1) return refused();
  const value = query.get("page") ?? "0";
  if (!/^(?:0|[1-9][0-9]*)$/.test(value) || !isPrivateGalleryHandle(handle)) return refused();
  const pageIndex = Number(value);
  if (!Number.isSafeInteger(pageIndex) || pageIndex >= Math.ceil(MAX_FILES / PAGE_SIZE)) return refused();
  try {
    const stores = getPrivateGalleryStores();
    const view = await readAuthorizedPrivateGalleryDeliveryPage(stores, {
      handle, cookieHeader: request.headers.get("cookie"), now: new Date(), pageIndex,
    });
    return view === undefined ? refused() : jsonNoStore({ ok: true, view }, 200);
  } catch {
    return refused();
  }
}
