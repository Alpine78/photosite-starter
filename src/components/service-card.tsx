import Image from "next/image";
import Link from "next/link";
import type { Service } from "@/lib/services";

type ServiceCardProps = {
  service: Service;
};

/**
 * A single service on the listing grid. The whole card is one link, so the
 * entire surface is clickable and reachable in one tab stop with a visible
 * focus ring.
 *
 * Both the cover media and the price are optional: a service without a cover
 * leads with its name, and one without a price simply omits it. The cover is
 * shown at its native aspect ratio (h-auto w-full, no fixed-height crop cell),
 * so card heights vary by design — images are never cropped.
 */
export function ServiceCard({ service }: ServiceCardProps) {
  const { slug, name, shortDescription, coverMedia, startingPrice } = service;

  return (
    <Link
      href={`/services/${slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-lg border border-black/10 transition-colors hover:border-black/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/15 dark:hover:border-white/40"
    >
      {coverMedia?.type === "image" && (
        <Image
          src={coverMedia.src}
          alt={coverMedia.alt}
          width={coverMedia.width}
          height={coverMedia.height}
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="h-auto w-full"
        />
      )}
      <div className="flex flex-1 flex-col p-6">
        <h2 className="text-lg font-medium tracking-tight">{name}</h2>
        <p className="mt-2 text-sm text-foreground/70">{shortDescription}</p>
        {startingPrice && (
          <p className="mt-4 text-sm font-medium text-foreground/80">
            {startingPrice}
          </p>
        )}
      </div>
    </Link>
  );
}
