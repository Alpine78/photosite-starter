/**
 * Every document and object type this site reads.
 *
 * A Studio consumes the result as its `schema.types`. Nothing in the
 * application imports this file: these definitions describe the content store,
 * and the application reads that store through the adapters in `src/lib`
 * instead (ADR-0006). The one link between the two is a test —
 * `sanity-media.test.ts` checks that the adapter projects only fields these
 * schemas declare — so the schema and the queries cannot drift apart unnoticed.
 *
 * The dataset's visibility has to be stated rather than assumed, because it
 * decides which fields may exist: a world-readable dataset is offered no place
 * to record where a master file lives. See `defineMediaType`.
 */

import { localizedTextType } from "./localized-text";
import { defineMediaType, type MediaSchemaOptions } from "./media";
import type { SchemaTypeDefinition } from "./schema-types";

export function defineSchemaTypes(
  options: MediaSchemaOptions,
): readonly SchemaTypeDefinition[] {
  return [localizedTextType, defineMediaType(options)];
}
