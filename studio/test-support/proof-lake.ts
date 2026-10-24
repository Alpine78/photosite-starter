import { evaluate, parse } from "groq-js/1";
import { memorySanityLake, type MemorySanityDocument } from "../../test-support/sanity-lake";
import { PROOF_DELETE_SWEEP_QUERY, type ProofDeletionReader } from "../proof-delete";

/** Query behavior stays Studio-only; the atomic store is shared with server tests. */
export function lake(initial: Record<string, unknown>[]) {
  const store = memorySanityLake(initial);
  let index: MemorySanityDocument[] | undefined;
  const reader: ProofDeletionReader = {
    docs: store.read,
    async sweep(galleryId, ids, assetIds) {
      return (await evaluate(parse(PROOF_DELETE_SWEEP_QUERY), { dataset: index ?? [...store.docs.values()], params: { galleryId, ids, assetIds } })).get();
    },
  };
  return { ...store, reader, freezeIndex: () => { index = [...store.docs.values()]; } };
}
