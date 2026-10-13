import "server-only";
import { headers } from "next/headers";
import { getDeploymentConfig } from "./deployment-config";
import { REQUEST_UI_LOCALE_HEADER, restrictedLocale } from "./restricted-page-locale";

export async function getRestrictedPageLocale(): Promise<string> {
  return restrictedLocale((await headers()).get(REQUEST_UI_LOCALE_HEADER), getDeploymentConfig().localeRoutes);
}
