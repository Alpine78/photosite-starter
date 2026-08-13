/**
 * Every document and object type this site reads, in one array.
 *
 * A Studio consumes it as its `schema.types`. Nothing in the application
 * imports this file: these definitions describe the content store, and the
 * application reads that store through the adapters in `src/lib` instead
 * (ADR-0006). The one link between the two is a test — `sanity-media.test.ts`
 * checks that the adapter projects only fields this schema declares — so the
 * schema and the queries cannot drift apart unnoticed.
 */

import { localizedTextType } from "./localized-text";
import { mediaType } from "./media";
import type { SchemaTypeDefinition } from "./schema-types";

export const schemaTypes: readonly SchemaTypeDefinition[] = [
  localizedTextType,
  mediaType,
];
