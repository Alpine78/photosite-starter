import { useCurrentLocale } from "sanity";
import { DndContext as NativeDndContext } from "@dnd-kit/core/dist/core.esm.js";
import type { DndContextProps } from "@dnd-kit/core";
import { dragAccessibility } from "./drag-accessibility";

// Keep a single native context for Sanity, sortable and their other consumers.
export * from "@dnd-kit/core/dist/core.esm.js";

/** Sanity's pinned SortableList does not forward accessibility options. */
export function DndContext(props: DndContextProps) {
  const { id } = useCurrentLocale();
  const copy = dragAccessibility(id);
  return <NativeDndContext {...props} accessibility={{
    ...copy,
    ...props.accessibility,
  }} />;
}
