import { notFound } from "next/navigation";
import { headers } from "next/headers";

import {
  AdminSignInForm,
  AdminSignOutButton,
} from "@/components/admin-sign-in-form";
import {
  authorizePrivateGalleryAdministrator,
  getPrivateGalleryAdminStores,
} from "@/lib/private-gallery-access";
import {
  getDefaultLocaleLabels,
  getDeploymentConfig,
} from "@/lib/deployment-config";

/**
 * The administrator surface (ADR-0015 §1, §2).
 *
 * One address serves both states, exactly as the customer namespace's does: with
 * a session that currently authorizes, it renders the signed-in view; without
 * one — expired, unknown, or minted against a superseded credential — it renders
 * the sign-in form. Nothing about which state a visitor sees reveals anything: a
 * stranger and an operator whose session ran out see the same page.
 *
 * Authorization is **re-derived on every request** from the cookie plus a fresh
 * credential read, so rotating `PRIVATE_GALLERY_ADMIN_SECRET_HASH` takes effect
 * on the next navigation rather than whenever a session would have run out.
 */
export const dynamic = "force-dynamic";

export default async function PrivateGalleryAdminPage() {
  const { privateGallery } = getDeploymentConfig();
  const text = getDefaultLocaleLabels().privateGalleryAdmin;

  // The namespace is reserved whether the feature is on or off; the *routes*
  // exist only when it is on.
  if (privateGallery.store === "off") notFound();

  const loginPath = `/${privateGallery.adminRoutePrefix}/login`;
  const logoutPath = `/${privateGallery.adminRoutePrefix}/logout`;

  let stores;
  try {
    stores = getPrivateGalleryAdminStores();
  } catch {
    // An `enabled` deployment with no adapter yet. Says so rather than showing
    // a sign-in form that could never succeed.
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold text-strong">{text.title}</h1>
        <p className="text-muted">{text.signInUnavailable}</p>
      </main>
    );
  }

  const authorization = await authorizePrivateGalleryAdministrator(
    { sessionStore: stores.sessionStore, environment: stores.environment },
    { cookieHeader: (await headers()).get("cookie"), now: new Date() },
  );

  if (!authorization.ok) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
        <h1 className="text-2xl font-semibold text-strong">{text.title}</h1>
        <AdminSignInForm
          action={loginPath}
          headingText={text.signInHeading}
          secretLabel={text.secretLabel}
          submitLabel={text.signIn}
          refusedText={text.signInRefused}
          javascriptRequiredText={text.javascriptRequired}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold text-strong">
        {text.signedInHeading}
      </h1>
      <p className="text-muted">{text.administrationPending}</p>
      <AdminSignOutButton action={logoutPath} label={text.signOut} />
    </main>
  );
}
