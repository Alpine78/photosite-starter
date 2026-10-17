import { createRef, type ReactNode, type Ref } from "react";
import { existingImageCapacity, existingImageReferences, type ExistingImageState, type ExistingClientImage, type PickerError } from "./existing-client-web-images";

const copy = {
  en: { opener: "Choose existing web images", close: "Close image chooser", loading: "Loading existing web images…", adding: "Checking selected images…", empty: "No eligible images in this result.", retry: "Try again", more: "Show more images", cutoff: "Uploaded before (optional)", cutoffHelp: "Enter the date and time in UTC, not your local time. Leave empty for the newest images. Changing this clears the selection; choose Search images to load another result.", search: "Search images", cleared: "Selection cleared. Search to load images.", newest: "Newest images (no date limit)", before: (value: string) => `Uploaded before ${value.replace("T", " ")} UTC`, emptyBefore: "No eligible images were uploaded before this time.", clear: "Clear selection", add: "Add selected images", notice: "Technical eligibility is not approval to publish an image. These are existing public files; write each image's alternative text before publishing.", limited: "Only the newest 256 matching images are shown. Change the date limit for older images, or use the native editor. Images uploaded within the same minute may require the native editor.", used: "Already in this gallery", count: (n: number, remaining: number) => `${n} selected; ${remaining} image slots left. Other editors and text size can still affect publication validation.`, image: (i: number, n: number, row: ExistingClientImage) => `Image ${i} of ${n}, ${row.width}×${row.height}, added ${new Intl.DateTimeFormat("en-GB", { timeZone: "UTC" }).format(new Date(row._createdAt))}`, order: (n: number) => `Selection order ${n}`, errors: { cutoff: "Enter a complete, valid UTC date and time, or clear the field.", load: "The image list could not be loaded.", permission: "Your Studio role cannot read these image assets.", changed: "The selected images or gallery changed. Check the selection and try again.", capacity: "There are not enough image slots left. Reduce the selection.", keys: "New image identifiers could not be created. Try again in a secure browser context." } },
  fi: { opener: "Valitse valmiita verkkokuvia", close: "Sulje kuvavalinta", loading: "Haetaan valmiita verkkokuvia…", adding: "Tarkistetaan valittuja kuvia…", empty: "Tässä tuloksessa ei ole kelvollisia kuvia.", retry: "Yritä uudelleen", more: "Näytä lisää kuvia", cutoff: "Ladattu ennen (valinnainen)", cutoffHelp: "Anna päivämäärä ja kellonaika UTC-ajassa, älä paikallisessa ajassa. Tyhjä kenttä näyttää uusimmat kuvat. Muuttaminen tyhjentää valinnan; hae uusi tulos Hae kuvat -painikkeella.", search: "Hae kuvat", cleared: "Valinta tyhjennetty. Hae kuvat uudelleen.", newest: "Uusimmat kuvat (ei aikarajausta)", before: (value: string) => `Ladattu ennen ${value.replace("T", " ")} UTC`, emptyBefore: "Ennen tätä ajankohtaa ladattuja kelvollisia kuvia ei löytynyt.", clear: "Tyhjennä valinta", add: "Lisää valitut kuvat", notice: "Tekninen kelpoisuus ei ole lupa julkaista kuvaa. Nämä tiedostot ovat jo julkisia; kirjoita jokaiselle kuvalle vaihtoehtoinen teksti ennen julkaisua.", limited: "Näkyvissä ovat vain 256 uusinta rajaukseen sopivaa kuvaa. Vaihda aikarajausta tai käytä tavallista editoria. Saman minuutin aikana ladattuja kuvia voi joutua lisäämään tavallisessa editorissa.", used: "Jo tässä galleriassa", count: (n: number, remaining: number) => `${n} valittu; ${remaining} kuvapaikkaa jäljellä. Muiden muokkaajien muutokset ja tekstien määrä vaikuttavat vielä julkaisun tarkistuksiin.`, image: (i: number, n: number, row: ExistingClientImage) => `Kuva ${i}/${n}, ${row.width}×${row.height}, lisätty ${new Intl.DateTimeFormat("fi-FI", { timeZone: "UTC" }).format(new Date(row._createdAt))}`, order: (n: number) => `Valintajärjestys ${n}`, errors: { cutoff: "Anna kelvollinen UTC-päivämäärä ja kellonaika kokonaan tai tyhjennä kenttä.", load: "Kuvaluetteloa ei voitu hakea.", permission: "Studio-käyttöoikeutesi eivät salli näiden kuvatiedostojen lukemista.", changed: "Valitut kuvat tai galleria muuttuivat. Tarkista valinta ja yritä uudelleen.", capacity: "Vapaat kuvapaikat eivät riitä. Vähennä valittuja kuvia.", keys: "Uusia kuvatunnisteita ei voitu muodostaa. Yritä uudelleen suojatussa selainympäristössä." } },
};
export function existingImageText(locale: string) { return copy[/^fi(?:-|$)/u.test(locale) ? "fi" : "en"]; }
export type ExistingImageViewProps = {
  id: string; locale: string; state: ExistingImageState; value: unknown; readOnly: boolean;
  openerRef?: Ref<HTMLButtonElement>; thumbnail(row: ExistingClientImage): ReactNode;
  onCutoffChange(value: string, badInput: boolean): void; onSearch(): void;
  onOpen(): void; onClose(): void; onRetry(): void; onMore(): void; onClear(): void; onToggle(id: string): void; onAdd(): void;
};
/** Native controls are kept separate so their actual markup can be verified offline. */
export function ExistingClientWebImagesView({ openerRef, ...props }: ExistingImageViewProps) {
  const text = existingImageText(props.locale), { state, readOnly } = props, open = state.phase !== "closed";
  const busy = state.phase === "loading" || state.phase === "adding", remaining = existingImageCapacity(props.value), used = existingImageReferences(props.value);
  const cutoffInput = createRef<HTMLInputElement>();
  const error = state.error ? text.errors[state.error as PickerError] : undefined;
  const canRetry = !readOnly && !busy && (state.phase === "error" || state.error === "changed" || state.error === "permission");
  const canShowMore = !readOnly && !busy && state.visible < state.rows.length;
  const canClear = !readOnly && !busy && state.selected.length > 0;
  const canAdd = canClear && state.selected.length <= remaining;
  return <div>
    <button type="button" ref={openerRef} disabled={readOnly} aria-expanded={open} aria-controls={props.id} onClick={open ? props.onClose : props.onOpen}>{text.opener}</button>
    {open && <section id={props.id} aria-label={text.opener} style={{ marginBlock: "1rem", padding: "1rem", border: "1px solid currentColor", borderRadius: "0.25rem" }}>
      <p>{text.notice}</p>
      <div>
        <label htmlFor={`${props.id}-cutoff`}>{text.cutoff}</label>
        <input ref={cutoffInput} id={`${props.id}-cutoff`} type="datetime-local" step={60}
          min="0001-01-01T00:00" max="9999-12-31T23:59" defaultValue={state.cutoff}
          readOnly={readOnly || state.phase === "adding"}
          aria-invalid={state.error === "cutoff" || state.badInput}
          aria-describedby={`${props.id}-cutoff-help${state.error === "cutoff" ? ` ${props.id}-error` : ""}`}
          onChange={event => props.onCutoffChange(event.currentTarget.value, event.currentTarget.validity.badInput)} />
        <p id={`${props.id}-cutoff-help`}>{text.cutoffHelp}</p>
        <button type="button" aria-disabled={readOnly || busy} onClick={() => {
          if (readOnly || busy || !cutoffInput.current) return;
          props.onCutoffChange(cutoffInput.current.value, cutoffInput.current.validity.badInput);
          props.onSearch();
        }}>{text.search}</button>
      </div>
      {state.phase === "ready" && <p>{state.cutoff ? text.before(state.cutoff) : text.newest}</p>}
      <p role="status" aria-live="polite">{busy ? state.phase === "loading" ? text.loading : text.adding : state.selectionCleared ? text.cleared : text.count(state.selected.length, remaining)}</p>
      {error && <p id={`${props.id}-error`} role="alert">{error}</p>}
      {/* Keep focusable anchors mounted when their action changes the visible state. */}
      <button type="button" aria-disabled={!canRetry} onClick={() => { if (canRetry) props.onRetry(); }}>{text.retry}</button>
      {state.phase === "ready" && state.rows.length === 0 && <p>{state.cutoff ? text.emptyBefore : text.empty}</p>}
      {state.rows.length > 0 && <ul style={{ listStyle: "none", padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: "1rem" }}>
        {state.rows.slice(0, state.visible).map((row, i) => {
          const selected = state.selected.indexOf(row._id);
          return <li key={row._id}>
            <label style={{ display: "grid", gap: "0.5rem" }}>
              <span style={{ display: "block", height: "8rem" }}>{props.thumbnail(row)}</span>
              <span><input type="checkbox" disabled={readOnly || busy} checked={selected >= 0} onChange={() => props.onToggle(row._id)} /> {text.image(i + 1, state.rows.length, row)}</span>
            </label>
            {selected >= 0 && <p>{text.order(selected + 1)}</p>}
            {used.has(row._id) && <p>{text.used}</p>}
          </li>;
        })}
      </ul>}
      {state.truncated && <p>{text.limited}</p>}
      <button type="button" aria-disabled={!canShowMore} onClick={() => { if (canShowMore) props.onMore(); }}>{text.more}</button>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <button type="button" aria-disabled={!canClear} onClick={() => { if (canClear) props.onClear(); }}>{text.clear}</button>
        <button type="button" onClick={props.onClose}>{text.close}</button>
        <button type="button" aria-disabled={!canAdd} onClick={() => { if (canAdd) props.onAdd(); }}>{text.add}</button>
      </div>
    </section>}
  </div>;
}
