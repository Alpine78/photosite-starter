/** Owner-reviewed curated galleries into the existing AB#137 write-plan boundary.
 * Offline only. The review digest binds every document, locator and source hash,
 * category requirement and source-evidence digest, before approval is accepted.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { IMPORT_PLAN_VERSION, validateMigrationDocuments, writablePlanDigest, type ImportPlan,
  type PlannedDocument, type AssetRequirement, type CategoryRequirement } from './joomla-import-plan.mts';
import { validatePlanContract } from './write-joomla-content.mts';
import { isRealCalendarDateTime } from './sanity-document-checks.mts';
import { CONVERSION_POLICY_VERSION } from './joomla-html-conversion.mts';

export type CuratedGalleryInput = {
  readonly documents: readonly PlannedDocument[];
  readonly assetRequirements: readonly AssetRequirement[];
  readonly categoryRequirements: readonly CategoryRequirement[];
  readonly sourceEvidenceDigest: string;
};
export type CuratedGalleryApproval = {
  readonly reviewDigest: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  /** Explicitly covers editorial content, public-image rights and privacy. */
  readonly approvedForImport: true;
};
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

export function buildCuratedGalleryPlan(input: CuratedGalleryInput, approval?: CuratedGalleryApproval): {
  readonly reviewDigest: string; readonly plan: ImportPlan;
} {
  const reviewDigest = sha(JSON.stringify(input));
  const provisional: ImportPlan = {
    version: IMPORT_PLAN_VERSION, conversionPolicy: CONVERSION_POLICY_VERSION,
    phase: 'launch', manifestDigest: sha(JSON.stringify(approval ?? null)), sourceExportDigest: reviewDigest,
    documents: input.documents, documentsDigest: '', assetRequirements: input.assetRequirements,
    categoryRequirements: input.categoryRequirements, photographIdentities: {}, blocked: [], errors: [],
    writable: false, notWritableBecause: [],
  };
  const contract = validatePlanContract(provisional);
  const errors = [...contract.issues];
  if (!/^[a-f0-9]{64}$/.test(input.sourceEvidenceDigest)) errors.push('A source-evidence SHA-256 digest is required');
  if (contract.plan) {
    errors.push(...validateMigrationDocuments(input.documents));
    if (!input.documents.some(d => d._type === 'gallery')) errors.push('At least one curated gallery is required');
    if (input.documents.some(d => !['gallery','galleryPlacement','media'].includes(d._type))) errors.push('Only curated galleries, placements and media belong in this plan');
  }
  const approved = approval?.approvedForImport === true && approval.reviewDigest === reviewDigest &&
    typeof approval.approvedBy === 'string' && approval.approvedBy.trim().length > 0 &&
    isRealCalendarDateTime(approval.approvedAt);
  if (!approved) errors.push('Owner approval of this exact curated-gallery review digest, including rights and privacy, is required');
  const documents = contract.plan?.documents ?? [];
  const assetRequirements = contract.plan?.assetRequirements ?? [];
  const categoryRequirements = contract.plan?.categoryRequirements ?? [];
  return { reviewDigest, plan: {
    ...provisional, documents, assetRequirements, categoryRequirements, errors,
    photographIdentities: Object.fromEntries(assetRequirements.map(a => [a.sourceLocator, a.mediaId])),
    documentsDigest: writablePlanDigest(documents, assetRequirements, errors, []),
    notWritableBecause: [...errors, 'Public asset and category references must be resolved by the owner-run writer'],
  }};
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 && args.length !== 3) throw new Error('Usage: node scripts/joomla-curated-gallery-plan.mts INPUT.json OUTPUT.json [OWNER-APPROVAL.json]');
  const input = JSON.parse(await readFile(args[0]!, 'utf8')) as CuratedGalleryInput;
  const approval = args[2] ? JSON.parse(await readFile(args[2], 'utf8')) as CuratedGalleryApproval : undefined;
  const result = buildCuratedGalleryPlan(input, approval);
  await writeFile(args[1]!, JSON.stringify(result.plan, null, 2) + '\n', {mode:0o600});
  console.log(`Review digest: ${result.reviewDigest}\nDocuments: ${result.plan.documents.length}; unresolved checks: ${result.plan.errors.length}\nWrite-plan digest: ${result.plan.documentsDigest}`);
  if (result.plan.errors.length) process.exitCode = 1;
}
if (import.meta.main) main().catch(error => {console.error(error instanceof Error ? error.message : String(error));process.exitCode=1;});
