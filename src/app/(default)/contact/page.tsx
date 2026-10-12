import { ContactPage, contactMetadata } from "@/components/contact-page";
import { getDeploymentConfig } from "@/lib/deployment-config";

type Props = { searchParams: Promise<{ service?: string | string[] }> };
export function generateMetadata() {
  return contactMetadata(getDeploymentConfig().localeRoutes.defaultLocale);
}
export default function Contact(props: Props) {
  return <ContactPage {...props} locale={getDeploymentConfig().localeRoutes.defaultLocale} />;
}
