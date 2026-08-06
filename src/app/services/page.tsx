import type { Metadata } from "next";
import { builtInLabels } from "@/lib/deployment-config";
import { getServices, getServicesIntro } from "@/lib/services";
import { getPageMetadata } from "@/lib/page-metadata";
import { ServiceCard } from "@/components/service-card";

export async function generateMetadata(): Promise<Metadata> {
  return getPageMetadata({
    path: "/services",
    title: builtInLabels.pages.services,
    description: await getServicesIntro(),
  });
}

export default async function ServicesPage() {
  const [services, intro] = await Promise.all([
    getServices(),
    getServicesIntro(),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {builtInLabels.pages.services}
        </h1>
        <p className="mt-3 text-foreground/70">{intro}</p>
      </header>

      {/* 1 / 2 / 3 columns. items-start lets each card keep its natural height
          (covers vary by native ratio; image-less cards don't stretch to match). */}
      <ul className="mt-12 grid items-start gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((service) => (
          <li key={service.slug}>
            <ServiceCard service={service} />
          </li>
        ))}
      </ul>
    </main>
  );
}
