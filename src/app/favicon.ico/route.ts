import { getSiteSettings } from "@/lib/site-settings";
import { FALLBACK_SITE_ICON } from "@/lib/site-icon";

/** Keep direct favicon requests aligned with the site's published brand mark. */
export async function GET(request: Request): Promise<Response> {
  let icon = FALLBACK_SITE_ICON;
  try {
    icon = (await getSiteSettings()).logo?.rendition.src ?? FALLBACK_SITE_ICON;
  } catch {
    // A temporary CMS failure must not break an otherwise static browser icon.
  }

  return new Response(null, {
    status: 307,
    headers: {
      Location: new URL(icon, request.url).toString(),
      "Cache-Control": "no-store",
    },
  });
}
