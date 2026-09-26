import Image from "next/image";
import Link from "next/link";
import type { Service } from "@/lib/services";
import { imageRenderProfiles } from "@/lib/image-delivery";

type ServiceCardProps = {
  service: Service;
  /** The route layer resolves this from the service's locale and ancestry. */
  href: string;
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
export function ServiceCard({ service, href }: ServiceCardProps) {
  const { name, shortDescription, coverMedia, startingPrice } = service;

  return (
    <Link
      href={href}
      className="group flex h-full flex-col gap-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {coverMedia?.type === "image" && (
        <Image
          src={coverMedia.rendition.src}
          alt={coverMedia.alt}
          width={coverMedia.rendition.width}
          height={coverMedia.rendition.height}
          sizes={imageRenderProfiles.serviceGrid.sizes}
          className="h-auto w-full rounded-sm bg-surface-muted"
        />
      )}
      <div className="flex flex-1 flex-col">
        <h2 className="text-xl font-semibold tracking-tight transition-colors group-hover:text-link-hover sm:text-2xl">
          {name}
        </h2>
        <p className="mt-2 line-clamp-3 max-w-prose text-base leading-relaxed text-muted sm:text-lg">
          {shortDescription}
        </p>
        {startingPrice && (
          <p className="mt-3 text-sm font-medium text-body">
            {startingPrice}
          </p>
        )}
      </div>
    </Link>
  );
}
