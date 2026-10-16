import { documentSnapshot, DraftActionError, type LocalizedDraftPort } from "./localized-draft-action-model";

type DraftDocument = Record<string, unknown> & { _id: string; _type: string };
/** Structural slice of the installed Studio client's public API, also usable by deterministic tests. */
export interface StudioDraftClient {
  withConfig(config: { useCdn: false; perspective: "raw"; maxRetries: 0 }): {
    fetch(query: string, params: Record<string, unknown>, options: { signal: AbortSignal }): Promise<unknown>;
    transaction(): {
      create(document: DraftDocument): unknown;
      commit(options: { autoGenerateArrayKeys: false; visibility: "sync" }): Promise<unknown>;
    };
  };
}

export function createLocalizedDraftPort(
  client: StudioDraftClient,
  current: () => { available: boolean; source: Readonly<Record<string, unknown>> | null },
  expectedSourceSnapshot: string,
): LocalizedDraftPort {
  const raw = client.withConfig({ useCdn: false, perspective: "raw", maxRetries: 0 });
  return {
    fetch: (query, params, signal) => raw.fetch(query, params, { signal }),
    create: async (documents) => {
      const state = current();
      if (!state.available || documentSnapshot(state.source) !== expectedSourceSnapshot) throw new DraftActionError("changed");
      const transaction = raw.transaction();
      for (const document of documents) transaction.create(document as DraftDocument);
      await transaction.commit({ autoGenerateArrayKeys: false, visibility: "sync" });
    },
  };
}
