import { NextResponse } from "next/server";

import { jsonNoStore } from "@/lib/contact-request";
import { getDeploymentConfig } from "@/lib/deployment-config";
import {
  authorizePrivateGalleryAdministrator,
  buildPrivateGalleryAdminLogoutCookie,
  checkPrivateGalleryAdminLoginRequestHeaders,
  getPrivateGalleryAdminStores,
  hashPrivateGalleryAdminSessionId,
  extractPrivateGalleryAdminSessionCookie,
} from "@/lib/private-gallery-access";

/**
 * Administrator sign-out.
 *
 * Deletes the session row **and** clears the cookie. Clearing only the cookie
 * would leave a live row that any copy of the identifier could still present —
 * a session is server state, and "log out" has to mean the server forgot it.
 *
 * It answers `200` whether or not there was a session to end, because there is
 * nothing to learn from the difference and an operator's next step is the same
 * either way. It reuses §3's request boundary like every other administrator
 * endpoint: `POST`, `application/json`, same-origin, `no-store`.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const { privateGallery } = getDeploymentConfig();
  if (privateGallery.store === "off") {
    return jsonNoStore({ ok: false }, 404);
  }

  if (checkPrivateGalleryAdminLoginRequestHeaders(request) !== undefined) {
    return jsonNoStore({ ok: false }, 400);
  }

  const done = NextResponse.json(
    { ok: true },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
  const clear = buildPrivateGalleryAdminLogoutCookie();
  done.cookies.set(clear.name, clear.value, clear.options);

  let stores;
  try {
    stores = getPrivateGalleryAdminStores();
  } catch {
    // No stores means no row to delete; the cookie is cleared regardless.
    return done;
  }

  const deps = {
    sessionStore: stores.sessionStore,
    environment: stores.environment,
  };
  const now = new Date();

  // Authorize before deleting, so this endpoint cannot be used to delete a row
  // named by an arbitrary identifier — the delete is scoped to a session that
  // currently authorizes, not to whatever the cookie happens to say.
  const authorization = await authorizePrivateGalleryAdministrator(deps, {
    cookieHeader: request.headers.get("cookie"),
    now,
  });
  if (!authorization.ok) return done;

  try {
    const cookieValue = extractPrivateGalleryAdminSessionCookie(
      request.headers.get("cookie"),
    );
    if (cookieValue !== undefined) {
      await stores.sessionStore.deleteByHash(
        hashPrivateGalleryAdminSessionId(cookieValue),
      );
    }
  } catch {
    // The cookie is already cleared on `done`; a store failure here leaves a row
    // that expires on its own rather than a signed-in browser.
  }

  return done;
}
