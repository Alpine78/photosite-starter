import { Button, Select, Stack, TextInput } from "@sanity/ui";
import { useEffect, useId, useRef, useState } from "react";
import { clientGalleryShareCopy, clientGalleryShareUrl, copyClientGalleryUrl, type ClientGallerySite } from "./client-gallery-share";

export function GalleryLinkDialog({ handle, site, locale, onClose }: {
  handle: string | undefined; site: ClientGallerySite; locale: string; onClose(): void;
}) {
  const copy = clientGalleryShareCopy(locale), id = useId();
  const [language, setLanguage] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ url: string; outcome: "copied" | "manual" }>();
  const input = useRef<HTMLInputElement>(null), mounted = useRef(false), inFlight = useRef(false);
  const url = clientGalleryShareUrl(site, handle, language);
  useEffect(() => {
    mounted.current = true;
    input.current?.focus(); input.current?.select();
    return () => { mounted.current = false; };
  }, []);
  async function runCopy() {
    if (!url || inFlight.current) return;
    inFlight.current = true; setPending(true);
    const outcome = await copyClientGalleryUrl(url, (value) => {
      if (!navigator.clipboard?.writeText) return Promise.reject(new Error("Clipboard unavailable"));
      return navigator.clipboard.writeText(value);
    });
    if (!mounted.current) return;
    inFlight.current = false; setPending(false); setResult({ url, outcome });
    if (outcome === "manual" && input.current?.value === url) { input.current.focus(); input.current.select(); }
  }
  const outcome = result?.url === url ? result?.outcome : undefined;
  return <Stack gap={3}>
    <p>{copy.publication}</p><p>{copy.publicAccess}</p><p>{copy.retention}</p>
    <Stack gap={2}><label htmlFor={`${id}-language`}>{copy.language}</label>{" "}
      <Select id={`${id}-language`} value={language} onChange={(event) => setLanguage(event.currentTarget.value)}>
        <option value="">{copy.defaultLanguage}</option>
        {site.locales.filter((tag) => tag.length <= 128).map((tag) => <option key={tag} value={tag}>{copy.languages[new Intl.Locale(tag).language] ?? tag} ({tag})</option>)}
      </Select>
    </Stack>
    <Stack gap={2}><label htmlFor={`${id}-url`}>{copy.url}</label>{" "}
      <TextInput id={`${id}-url`} ref={input} readOnly value={url ?? ""} autoComplete="off" spellCheck={false} />
    </Stack>
    <p role="status">{!url ? copy.unavailable : pending ? copy.copying : outcome === "copied" ? copy.copied : outcome === "manual" ? copy.manual : ""}</p>
    <Button type="button" disabled={!url || pending} onClick={() => void runCopy()} text={copy.copy} />{" "}
    <Button type="button" onClick={onClose} text={copy.close} />
  </Stack>;
}

