/**
 * `npm run recompute:shuffled-order -- --gallery <contentId> --language <lang>`
 *
 * The owner-run step that materializes a seeded-random gallery's `shuffledOrder`
 * keys after the seed changes (AB#129 PR2, ADR-0009 2026-08-28 amendment).
 * Rotation is two steps: (1) edit `orderingSeed` in Studio and publish, (2) run
 * this. Between the two the public site serves the gallery as temporarily
 * unavailable (`ordering-stale`); it recovers on its own once every placement
 * patch here has landed and the `sanity:galleries` cache tag is invalidated —
 * this command's final check gates only its own exit code, not the read path.
 *
 * Without `--yes` this is a dry run: it reads, prints the plan, and writes
 * nothing. `--yes` requires `SANITY_SEED_TOKEN` (a write-scoped Editor
 * credential — never the runtime app's `SANITY_READ_TOKEN`), passed through the
 * environment only, never a flag (`ps` and shell history).
 *
 * Optimistic concurrency (an editor may touch the gallery or a placement mid-
 * run): every patch carries the `_rev` it was planned against (`ifRevisionID`);
 * a 409 re-reads that one placement and retries, bounded. The gallery's
 * `_rev`/`orderingSeed` are re-read before the first and after the last patch —
 * a change there aborts with "re-run", nothing half-written claims success. A
 * final authoritative consistency query catches a placement added or removed
 * during the run.
 *
 * Operates on the *published* documents (a recompute is a post-publish step; a
 * draft has no public reads to keep consistent) — and for that reason it
 * refuses to run while any Studio draft of this gallery (`drafts.<id>`) or one
 * of its placements exists, checked *both* before writing and again as part of
 * the final gate, since publishing that draft later would silently undo the run.
 * `--gallery` and `--language` are both required; an ambiguous or absent match
 * aborts rather than guessing.
 *
 * Self-contained (`scripts/*.mts` import nothing from `src/lib`): the pure
 * decision logic is `recompute-shuffled-order-plan.mts`.
 */

import {
  parseSeedConnection,
  runSeedQuery,
  SanitySeedHttpError,
  type SeedConnection,
} from "./sanity-seed-http.mts";
import { sendSanityHttpRequest } from "./sanity-read-http.mts";
import {
  planShuffledOrderRecompute,
  RecomputePlanError,
  type RecomputePatch,
  type RecomputePlacement,
} from "./recompute-shuffled-order-plan.mts";

const MAX_CONFLICT_RETRIES = 5;

function fail(message: string): never {
  console.error(`recompute:shuffled-order failed: ${message}`);
  process.exit(1);
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) fail(`--${name} requires a value`);
  return value;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function requiredSetting(flagName: string, envName: string): string {
  const value = readFlag(flagName) ?? process.env[envName];
  if (!value) fail(`missing ${envName} (or --${flagName})`);
  return value;
}

type RawGallery = {
  readonly _id?: unknown;
  readonly _rev?: unknown;
  readonly orderingRule?: unknown;
  readonly orderingSeed?: unknown;
};

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function readGallery(
  connection: SeedConnection,
  contentId: string,
  language: string,
): Promise<{ id: string; rev: string; orderingRule: string; orderingSeed: string | null }> {
  const result = (await runSeedQuery(connection, {
    query:
      '*[_type == "gallery" && contentId == $contentId && language == $language]{_id, _rev, orderingRule, orderingSeed}',
    params: { contentId, language },
    perspective: "published",
  })) as readonly RawGallery[];

  if (!Array.isArray(result) || result.length === 0) {
    fail(`no published gallery has contentId "${contentId}" in language "${language}"`);
  }
  if (result.length > 1) {
    fail(
      `${result.length} published gallery documents claim contentId "${contentId}" in language "${language}" — resolve the ambiguity before recomputing`,
    );
  }
  const doc = result[0];
  const id = str(doc._id);
  const rev = str(doc._rev);
  const orderingRule = str(doc.orderingRule);
  if (id === undefined || rev === undefined || orderingRule === undefined) {
    fail("the gallery document is missing _id, _rev, or orderingRule");
  }
  return { id, rev, orderingRule, orderingSeed: str(doc.orderingSeed) ?? null };
}

type RawPlacement = {
  readonly _id?: unknown;
  readonly _rev?: unknown;
  readonly placementId?: unknown;
  readonly pinned?: unknown;
  readonly shuffledOrder?: unknown;
  readonly shuffledOrderSeed?: unknown;
};

function toRecomputePlacement(raw: RawPlacement): RecomputePlacement {
  const id = str(raw._id);
  const rev = str(raw._rev);
  const placementId = str(raw.placementId);
  if (id === undefined || rev === undefined || placementId === undefined) {
    fail("a galleryPlacement is missing _id, _rev, or placementId");
  }
  return {
    _id: id,
    _rev: rev,
    placementId,
    pinned: raw.pinned === true,
    shuffledOrder: str(raw.shuffledOrder) ?? null,
    shuffledOrderSeed: str(raw.shuffledOrderSeed) ?? null,
  };
}

async function readPlacements(
  connection: SeedConnection,
  galleryId: string,
): Promise<readonly RecomputePlacement[]> {
  const result = (await runSeedQuery(connection, {
    query:
      '*[_type == "galleryPlacement" && gallery._ref == $galleryId]{_id, _rev, placementId, "pinned": coalesce(pinned, false), shuffledOrder, shuffledOrderSeed}',
    params: { galleryId },
    perspective: "published",
  })) as readonly RawPlacement[];
  if (!Array.isArray(result)) fail("the placement query did not return a list");
  return result.map(toRecomputePlacement);
}

/**
 * Any outstanding Studio draft of this gallery or one of its placements. The
 * recompute reads and patches the *published* perspective only; a draft keeps
 * its old (or absent) generated fields, and publishing it later would silently
 * undo this run and take the gallery `ordering-stale` again. So a draft is a
 * precondition failure: resolve it in Studio, then re-run. Read `raw` (a draft
 * lives under a `drafts.` id that the default perspective hides).
 */
async function findOutstandingDrafts(
  connection: SeedConnection,
  galleryId: string,
): Promise<readonly string[]> {
  // The gallery's own draft lives at `drafts.<galleryId>` — its `_id` is not
  // `$galleryId`, so it is matched by an explicit id, not the placement clause.
  const result = (await runSeedQuery(connection, {
    query:
      '*[(_id == $galleryDraftId || (_type == "galleryPlacement" && gallery._ref == $galleryId)) && _id in path("drafts.**")]._id',
    params: { galleryId, galleryDraftId: `drafts.${galleryId}` },
    perspective: "raw",
  })) as readonly unknown[];
  if (!Array.isArray(result)) fail("the draft-check query did not return a list");
  return result.filter((id): id is string => typeof id === "string");
}

async function readPlacementState(
  connection: SeedConnection,
  id: string,
): Promise<{ rev: string; placementId: string; pinned: boolean } | undefined> {
  const result = (await runSeedQuery(connection, {
    query: '*[_id == $id][0]{_rev, placementId, "pinned": coalesce(pinned, false)}',
    params: { id },
    perspective: "published",
  })) as
    | { readonly _rev?: unknown; readonly placementId?: unknown; readonly pinned?: unknown }
    | null;
  if (result === null) return undefined;
  const rev = str(result._rev);
  const placementId = str(result.placementId);
  if (rev === undefined || placementId === undefined) return undefined;
  return { rev, placementId, pinned: result.pinned === true };
}

/** Sends one single-mutation patch. Returns `"ok"`, `"conflict"` (409), or throws. */
async function sendPatch(
  connection: SeedConnection,
  patch: RecomputePatch,
): Promise<"ok" | "conflict"> {
  const url = `https://${connection.projectId}.api.sanity.io/${connection.apiVersion}/data/mutate/${connection.dataset}`;
  const mutation: Record<string, unknown> = {
    id: patch.id,
    ifRevisionID: patch.ifRevisionID,
  };
  if (patch.set !== undefined) mutation.set = patch.set;
  if (patch.unset !== undefined) mutation.unset = [...patch.unset];

  const response = await sendSanityHttpRequest(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${connection.token}`,
      },
      body: JSON.stringify({ mutations: [{ patch: mutation }] }),
    },
    undefined,
  );
  if (response.ok) return "ok";
  if (response.status === 409) return "conflict";
  throw new SanitySeedHttpError(
    `patch of ${patch.placementId} failed with HTTP ${response.status}`,
    response.status,
  );
}

async function applyPatch(
  connection: SeedConnection,
  patch: RecomputePatch,
): Promise<void> {
  let current = patch;
  for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt += 1) {
    const outcome = await sendPatch(connection, current);
    if (outcome === "ok") return;

    // A 409 means an editor changed this placement. Re-read its full state,
    // not just `_rev`: if `placementId` or `pinned` changed, the planned key
    // (an HMAC of the *old* placementId, or a key for the wrong tier) is now
    // wrong — retrying with a fresh `_rev` would write a defined-but-incorrect
    // key that the public stale guard cannot detect. Abort; a rerun replans it.
    const fresh = await readPlacementState(connection, current.id);
    if (fresh === undefined) {
      fail(
        `placement ${current.placementId} disappeared during the run — re-run the command`,
      );
    }
    if (fresh.placementId !== current.placementId) {
      fail(
        `placement ${current.id} changed its placementId (${current.placementId} -> ${fresh.placementId}) during the run — re-run so its key is recomputed`,
      );
    }
    if (current.plannedPinned !== undefined && fresh.pinned !== current.plannedPinned) {
      fail(
        `placement ${current.placementId} changed its pinned flag during the run — re-run so its key is recomputed`,
      );
    }
    current = { ...current, ifRevisionID: fresh.rev };
  }
  fail(
    `placement ${current.placementId} kept changing under the recompute (${MAX_CONFLICT_RETRIES} conflicts) — re-run when Studio edits settle`,
  );
}

async function main(): Promise<void> {
  const contentId = requiredSetting("gallery", "RECOMPUTE_GALLERY_CONTENT_ID");
  const language = requiredSetting("language", "RECOMPUTE_GALLERY_LANGUAGE");
  const write = hasFlag("yes");

  const connection = parseSeedConnection({
    projectId: requiredSetting("project", "SANITY_PROJECT_ID"),
    dataset: requiredSetting("dataset", "SANITY_DATASET"),
    apiVersion: requiredSetting("api-version", "SANITY_API_VERSION"),
    // Read-only for the dry run, write-scoped for `--yes`. Both are the same
    // Editor credential in practice; the environment-only rule is unchanged.
    token: write
      ? (process.env.SANITY_SEED_TOKEN ?? fail("missing SANITY_SEED_TOKEN (required with --yes)"))
      : (process.env.SANITY_SEED_TOKEN ??
          process.env.SANITY_READ_TOKEN ??
          fail("missing SANITY_SEED_TOKEN or SANITY_READ_TOKEN")),
  });

  const gallery = await readGallery(connection, contentId, language);
  const placements = await readPlacements(connection, gallery.id);

  let plan;
  try {
    plan = planShuffledOrderRecompute({
      orderingRule: gallery.orderingRule,
      orderingSeed: gallery.orderingSeed,
      placements,
    });
  } catch (error) {
    if (error instanceof RecomputePlanError) fail(error.message);
    throw error;
  }

  console.log(
    `Gallery "${contentId}" (${language}): rule=${gallery.orderingRule}` +
      `${plan.seed === undefined ? "" : `, seed="${plan.seed}"`}`,
  );
  console.log(
    `${placements.length} placement(s): ${plan.patches.length} to update, ${plan.unchanged} already consistent.`,
  );

  if (!write) {
    console.log("\nDry run — no network write was made. Re-run with --yes to apply.");
    return;
  }

  const drafts = await findOutstandingDrafts(connection, gallery.id);
  if (drafts.length > 0) {
    fail(
      `${drafts.length} outstanding Studio draft(s) for this gallery or its placements ` +
        `(${drafts.slice(0, 5).join(", ")}${drafts.length > 5 ? ", …" : ""}). ` +
        "Publish or discard them in Studio first — this command patches only published documents, " +
        "so publishing a draft afterwards would undo the recompute.",
    );
  }

  const beforeRev = (
    await runSeedQuery(connection, {
      query: "*[_id == $id][0]{_rev, orderingRule, orderingSeed}",
      params: { id: gallery.id },
      perspective: "published",
    })
  ) as RawGallery | null;
  if (
    beforeRev === null ||
    str(beforeRev._rev) !== gallery.rev ||
    str(beforeRev.orderingRule) !== gallery.orderingRule ||
    (str(beforeRev.orderingSeed) ?? null) !== gallery.orderingSeed
  ) {
    fail(
      "the gallery was edited before the recompute started — re-run so every placement matches the latest seed",
    );
  }

  for (const [index, patch] of plan.patches.entries()) {
    await applyPatch(connection, patch);
    if ((index + 1) % 25 === 0 || index + 1 === plan.patches.length) {
      console.log(`  applied ${index + 1}/${plan.patches.length}`);
    }
  }
  if (plan.patches.length === 0) {
    console.log("Nothing to patch — verifying the gallery is genuinely consistent.");
  }

  // The gallery must not have been re-edited (a new seed, a rule change) while
  // this ran — otherwise the keys just written are already stale. Runs even
  // when zero patches were planned: an editor may have changed the seed or
  // added a placement between the initial reads and now, and the repository
  // contract is that this command's *final* check gates success.
  const afterRev = (
    await runSeedQuery(connection, {
      query: "*[_id == $id][0]{_rev, orderingRule, orderingSeed}",
      params: { id: gallery.id },
      perspective: "published",
    })
  ) as RawGallery | null;
  if (
    afterRev === null ||
    str(afterRev._rev) !== gallery.rev ||
    str(afterRev.orderingRule) !== gallery.orderingRule ||
    (str(afterRev.orderingSeed) ?? null) !== gallery.orderingSeed
  ) {
    fail(
      "the gallery was edited during the recompute — re-run the command so every placement matches the latest seed",
    );
  }

  // A draft created *during* the run would restore stale generated fields (or a
  // different seed) the moment it is published, undoing this run — so the
  // draft precondition is re-checked as part of the final gate, not only before
  // writing.
  const draftsAfter = await findOutstandingDrafts(connection, gallery.id);
  if (draftsAfter.length > 0) {
    fail(
      `${draftsAfter.length} Studio draft(s) for this gallery or its placements were created during the run ` +
        `(${draftsAfter.slice(0, 5).join(", ")}${draftsAfter.length > 5 ? ", …" : ""}). ` +
        "Publish or discard them, then re-run — publishing a draft now would undo this recompute.",
    );
  }

  // Final authoritative consistency check (gates this command's exit code only).
  const finalPlacements = await readPlacements(connection, gallery.id);
  const finalPlan = planShuffledOrderRecompute({
    orderingRule: gallery.orderingRule,
    orderingSeed: gallery.orderingSeed,
    placements: finalPlacements,
  });
  if (finalPlan.patches.length > 0) {
    fail(
      `${finalPlan.patches.length} placement(s) are still inconsistent — a placement was likely added or its identity changed during the run. Re-run the command.`,
    );
  }

  console.log(
    `\nDone. ${plan.patches.length} placement(s) updated; gallery is verified consistent. ` +
      "The public site recovers once the sanity:galleries cache tag is invalidated (the placement writes above, or the seed edit itself, do that).",
  );
}

await main();
