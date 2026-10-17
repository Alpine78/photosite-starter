import { createElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { insert, setIfMissing, useClient, useCurrentLocale, useFormValue, type ArrayOfObjectsInputProps } from "sanity";
import type { SchemaFieldDefinition, SchemaTypeDefinition } from "../sanity/schemas/schema-types";
import { STUDIO_VALIDATION_API_VERSION } from "../sanity/schemas/validation";
import { createExistingImageController, type ExistingImageScope, type NewClientItem } from "./existing-client-web-images";
import { ExistingClientWebImagesView } from "./existing-client-web-images-view";
import { FullFrameMedia } from "./full-frame-media";

export function existingClientImagePatches(items: readonly NewClientItem[]) {
  return [setIfMissing([]), insert([...items], "after", [-1])];
}
export function ExistingClientWebImagesInput(props: ArrayOfObjectsInputProps) {
  const suppliedClient = useClient({ apiVersion: STUDIO_VALIDATION_API_VERSION });
  const client = useMemo(() => suppliedClient.withConfig({ useCdn: false, perspective: "raw" }), [suppliedClient]);
  const documentId = useFormValue(["_id"]), locale = useCurrentLocale().id;
  const { readOnly, value, onChange, path: fieldPath } = props;
  const path = JSON.stringify([client.config().projectId, client.config().dataset, fieldPath]);
  const opener = useRef<HTMLButtonElement>(null), id = useId();
  // Lazy, stable, closed and unbound until the layout effect below commits the latest scope.
  const [controller] = useState(() => createExistingImageController());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(() => {
    const scope: ExistingImageScope = { documentId: typeof documentId === "string" ? documentId : "", path, readOnly: Boolean(readOnly), value,
      append: items => onChange(existingClientImagePatches(items)) };
    controller.bind({
      getScope: () => scope,
      read: request => client.fetch(request.query, request.ids ? { ids: request.ids } : {}, {
        signal: request.signal, perspective: "raw", useCdn: false, timeout: 20_000,
      }),
    });
    controller.scopeChanged();
  }, [controller, client, documentId, path, readOnly, value, onChange]);
  useEffect(() => () => controller.dispose(), [controller]);
  function close() { controller.close(); opener.current?.focus(); }
  return <>
    <ExistingClientWebImagesView id={id} locale={locale} state={state} value={props.value}
      readOnly={Boolean(props.readOnly) || typeof documentId !== "string"} openerRef={opener}
      thumbnail={row => <FullFrameMedia assetId={row._id} lazy />}
      onOpen={() => { void controller.open(); }} onClose={close} onRetry={() => { void controller.open(); }}
      onMore={controller.showMore} onClear={controller.clear} onToggle={controller.toggle}
      onAdd={() => { void controller.add().then(() => { if (controller.getSnapshot().phase === "closed") opener.current?.focus(); }); }} />
    {props.renderDefault(props)}
  </>;
}

type Input = ComponentType<ArrayOfObjectsInputProps>;
type StudioField = SchemaFieldDefinition & { components?: { input?: Input; [key: string]: unknown } };
const decorated = new WeakSet<Input>(); decorated.add(ExistingClientWebImagesInput);
/** Decorate only this array, retain a previously installed input and never mutate shared schemas. */
export function withExistingClientWebImages(schema: SchemaTypeDefinition): SchemaTypeDefinition {
  if (schema.name !== "clientDeliveryGallery") return schema;
  let changed = false;
  const fields = schema.fields.map(field => {
    if (field.name !== "items" || field.type !== "array") return field;
    const studioField = field as StudioField, previous = studioField.components?.input;
    if (previous && decorated.has(previous)) return field;
    const Input: Input = previous ? function DecoratedExistingInput(props) {
      return <ExistingClientWebImagesInput {...props} renderDefault={next => createElement(previous, { ...(next as ArrayOfObjectsInputProps), renderDefault: props.renderDefault })} />;
    } : ExistingClientWebImagesInput;
    decorated.add(Input); changed = true;
    return { ...field, components: { ...studioField.components, input: Input } };
  });
  return changed ? { ...schema, fields } : schema;
}
