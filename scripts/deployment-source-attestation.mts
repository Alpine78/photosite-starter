/** A checkout attestation, not a claim about prebuilt artifact contents. */
export type CheckoutEvidence = { head: string; expectedTree: string; headTree: string; status: string };
export function attestDeploymentSource(expectedSha: string, evidence: CheckoutEvidence) {
  const sha = /^[a-f0-9]{40}$/;
  if (!sha.test(expectedSha) || !sha.test(evidence.head) || !sha.test(evidence.expectedTree) || !sha.test(evidence.headTree)) throw new Error("INVALID_SOURCE_IDENTITY");
  if (evidence.head !== expectedSha || evidence.expectedTree !== evidence.headTree) throw new Error("SOURCE_IDENTITY_MISMATCH");
  if (evidence.status !== "") throw new Error("SOURCE_CHECKOUT_DIRTY");
  return { version: 1, sourceSha: expectedSha, treeSha: evidence.headTree, gitDirty: "0", artifactContentsVerified: false };
}
