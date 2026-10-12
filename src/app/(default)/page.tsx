import { HomePage, homeMetadata } from "@/components/home-page";
import { getDeploymentConfig } from "@/lib/deployment-config";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
export function generateMetadata(props: Props) {
  return homeMetadata({ ...props, locale: getDeploymentConfig().localeRoutes.defaultLocale });
}
export default function Home(props: Props) {
  return <HomePage {...props} locale={getDeploymentConfig().localeRoutes.defaultLocale} />;
}
