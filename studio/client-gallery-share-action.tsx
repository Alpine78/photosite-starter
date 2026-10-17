import { useState } from "react";
import { useCurrentLocale, type DocumentActionComponent } from "sanity";
import { studioSettings } from "./environment";
import { clientGalleryShareCopy, publishedClientGalleryHandle } from "./client-gallery-share";
import { GalleryLinkDialog } from "./client-gallery-share-dialog";

export const ShareClientGalleryAction: DocumentActionComponent = (props) => {
  const { id: locale } = useCurrentLocale(), copy = clientGalleryShareCopy(locale);
  const [open, setOpen] = useState(false);
  if (props.type !== "clientDeliveryGallery") return null;
  const handle = publishedClientGalleryHandle(props), site = studioSettings.clientGallerySite;
  const supported = studioSettings.datasetVisibility === "public";
  return {
    label: copy.action, disabled: !site || !handle || !supported,
    title: !site ? copy.configure : !supported ? copy.publicDataset : !handle ? copy.unavailable : undefined,
    onHandle: () => { if (site && handle && supported) setOpen(true); },
    dialog: open && site ? { type: "dialog", header: copy.action, onClose: () => setOpen(false),
      content: <GalleryLinkDialog key={props.id} handle={supported ? handle : undefined} site={site} locale={locale} onClose={() => setOpen(false)} />,
    } : undefined,
  };
};
