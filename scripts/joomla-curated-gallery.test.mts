import { buildCuratedGalleryPlan, main as runCuratedPlanner } from './joomla-curated-gallery-plan.mts';
import { describe, it, expect, vi } from 'vitest';
import { validateCuratedGalleryDocuments, MAX_IMPORT_ORDERING_SEED_LENGTH } from './joomla-curated-gallery.mts';
import { computeShuffledOrder } from '../src/lib/gallery-shuffle';
import { MAX_GALLERY_ORDERING_SEED_LENGTH } from '../src/lib/gallery-pagination';
import { MAX_ORDERING_SEED_LENGTH } from '../sanity/schemas/gallery';
import { IMPORT_PLAN_VERSION, validateMigrationDocuments, type PlannedDocument } from './joomla-import-plan.mts';
import { validatePlanContract, collectRequiredCategoryLanguages, splitIntoWaves, runCollisionPreflight } from './write-joomla-content.mts';
import { parseSeedConnection } from './sanity-seed-http.mts';
const ref = (_ref: string) => ({_type:'reference', _ref});
function documents(): PlannedDocument[] {
  return [
    {_id:'migrated--media-photo',_type:'media',mediaId:'photo',mediaType:'image',publiclyRenderable:true,alt:[{_type:'localizedText',_key:'fi',language:'fi',value:'A photograph'}],image:{_type:'image',asset:ref('migrated-pending-asset:photo')}},
    ...['fi','en'].flatMap(language => [
      {_id:`migrated--gallery-trip-${language}`,_type:'gallery',contentId:'trip',language,title:'Trip',slug:'trip',publishedAt:'2020-01-01T00:00:00Z',orderingRule:'manual',canonicalCategory:ref('migrated-pending-category:travel'),cover:ref('migrated--media-photo'),sections:[{_key:'one',_type:'object',sectionId:'one',slug:'first',label:'First'}],body:[]},
      {_id:`migrated--placement-one-${language}`,_type:'galleryPlacement',gallery:ref(`migrated--gallery-trip-${language}`),media:ref('migrated--media-photo'),placementId:'occurrence-one',order:1,sectionId:'one',visible:true,altOverride:'A photograph',captionOverride:'Caption'}
    ])
  ];
}
function plan(ds=documents()) {
  return {version:IMPORT_PLAN_VERSION,documents:ds,assetRequirements:[{mediaId:'photo',sourceLocator:'photo.jpg',contentHash:'a'.repeat(64)}],categoryRequirements:[{categoryId:'travel'}],errors:[],blocked:[]};
}
function shuffledDocuments(): PlannedDocument[] {
  const ds=documents(),seed='synthetic-gallery-v1';
  ds[1]={...ds[1]!,orderingRule:'seeded-random',orderingSeed:seed};
  ds[2]={...ds[2]!,shuffledOrderSeed:seed,shuffledOrder:computeShuffledOrder(seed,'occurrence-one')};
  return ds;
}
describe('seeded gallery import',()=>{
  it('uses the runtime and Studio seed limit',()=>{
    expect(MAX_IMPORT_ORDERING_SEED_LENGTH).toBe(MAX_GALLERY_ORDERING_SEED_LENGTH);
    expect(MAX_IMPORT_ORDERING_SEED_LENGTH).toBe(MAX_ORDERING_SEED_LENGTH);
  });
  it('accepts a seeded locale alongside its manually ordered translation',()=>{
    const ds=shuffledDocuments();
    expect(validateMigrationDocuments(ds)).toEqual([]);
    expect(validatePlanContract(plan(ds)).issues).toEqual([]);
  });
  it.each([undefined,null,'',' ',' seed','seed ','x'.repeat(241),42])('refuses an invalid seed %j',seed=>{
    const ds=shuffledDocuments();ds[1]={...ds[1]!,orderingSeed:seed};
    expect(validatePlanContract(plan(ds)).issues.join(' ')).toContain('orderingSeed');
  });
  it.each([
    {shuffledOrder:undefined},{shuffledOrder:'a'.repeat(64)},
    {shuffledOrderSeed:'old-seed'},{shuffledOrderSeed:undefined},
    {placementId:'another-occurrence'},
  ])('refuses stale, missing or identity-mismatched keys %#',patch=>{
    const ds=shuffledDocuments();ds[2]={...ds[2]!,...patch};
    expect(validatePlanContract(plan(ds)).issues.join(' ')).toMatch(/shuffledOrder/);
  });
  it('refuses shuffle state in manual galleries and pinned migration rows',()=>{
    for(const patch of [{shuffledOrder:'a'.repeat(64)},{shuffledOrderSeed:'seed'},{pinned:true}]){
      const ds=documents();ds[2]={...ds[2]!,...patch};expect(validateMigrationDocuments(ds).length).toBeGreaterThan(0);
    }
    const ds=documents();ds[1]={...ds[1]!,orderingSeed:'seed'};
    expect(validateMigrationDocuments(ds).join(' ')).toContain('manual ordering');
  });
});
describe('curated gallery migration',()=>{
  it('preserves a listing-only Joomla lead and refuses a malformed flag',()=>{
    const ds=documents();
    ds[1]={...ds[1]!,summary:'A listing introduction.',summaryListingOnly:true};
    expect(validateCuratedGalleryDocuments(ds)).toEqual([]);
    expect(validatePlanContract(plan(ds)).issues).toEqual([]);
    for(const patch of [{summaryListingOnly:false},{summaryListingOnly:'true'},{summary:''},{summary:undefined}]){
      expect(validateCuratedGalleryDocuments(ds.map(d=>d._type==='gallery'?{...d,...patch}:d)).join(' ')).toContain('summaryListingOnly');
    }
  });
  it('accepts matching bilingual occurrences and an empty gallery body',()=>{
    expect(validateCuratedGalleryDocuments(documents())).toEqual([]);
    expect(validateMigrationDocuments(documents())).toEqual([]);
    expect(validatePlanContract(plan()).issues).toEqual([]);
    expect([...collectRequiredCategoryLanguages(documents()).get('travel')!]).toEqual(['fi','en']);
  });
  it('writes gallery containers before every placement, even when input is reversed',()=>{
    const waves=splitIntoWaves(documents().reverse());
    expect(waves.map(w=>w.map(d=>d._type))).toEqual([['media'],['gallery','gallery'],['galleryPlacement','galleryPlacement']]);
  });
  it('preserves distinct occurrences of one image and separate covers',()=>{
    const ds=documents();
    ds.push({...ds[2]!,_id:'migrated--placement-two-fi',placementId:'occurrence-two',order:2});
    expect(validateMigrationDocuments(ds)).toEqual([]);
    expect(validateMigrationDocuments(ds.filter(d=>d._type!=='galleryPlacement'))).toEqual([]);
  });
  it.each([
    ['section mismatch',{sectionId:'missing'}],['hidden placement',{visible:false}],['duplicate order',{order:1.2}],
    ['private media reference',{media:ref('unknown')}],['raw metadata',{archiveLocator:'private'}],
    ['non-text caption',{captionOverride:{secret:'x'}}]
  ])('refuses %s',(_name, patch)=>{
    const ds=documents();ds[2]={...ds[2]!,...patch};expect(validateCuratedGalleryDocuments(ds).length).toBeGreaterThan(0);
  });
  it.each([
    {orderingRule:'seeded-random'}, {publishedAt:'2020-02-30T00:00:00Z'},
    {sections:[{_key:'x',sectionId:'one',slug:'all',label:'All'}]},
    {sections:[{_key:'x',sectionId:'one',slug:'first',label:'First',archiveLocator:'private'}]},
    {cover:ref('missing')}, {language:'en-GB'}, {secondaryCategories:'not-an-array'}
  ])('refuses malformed gallery %#',(patch)=>{
    const ds=documents();ds[1]={...ds[1]!,...patch};expect(validateCuratedGalleryDocuments(ds).length).toBeGreaterThan(0);
  });
  it('refuses variant conflicts across locales and duplicate placements within a locale',()=>{
    const ds=documents();ds[3]={...ds[3]!,_type:'article'};
    expect(validateCuratedGalleryDocuments(ds).join(' ')).toContain('variant');
    const repeated=documents();repeated.push({...repeated[2]!,_id:'migrated--placement-another',order:2});
    expect(validateCuratedGalleryDocuments(repeated).join(' ')).toContain('repeats within one language');
  });
  it('refuses private fields nested inside references before a write',()=>{
    const ds=documents();ds[1]={...ds[1]!,cover:{...ref('migrated--media-photo'),archiveLocator:'secret'}};
    expect(validatePlanContract(plan(ds)).issues.join(' ')).toContain('unrecognized field');
  });
  it('refuses an unknown section membership in a translated occurrence',()=>{
    const ds=documents();ds[3]={...ds[3]!,sections:[{_key:'two',sectionId:'two',slug:'second',label:'Second'}]};ds[4]={...ds[4]!,sectionId:'two'};
    expect(validateCuratedGalleryDocuments(ds).join(' ')).toContain('different occurrences');
  });
});
const connection = parseSeedConnection({projectId:'abc123',dataset:'preview',apiVersion:'v2024-01-01',token:'synthetic'});
function mockRows(choose:(query:string)=>unknown[]) {
 return {fetchImplementation:(async (input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input),query=init?.body?JSON.parse(String(init.body)).query:new URL(url).searchParams.get('query')??'';
  return new Response(JSON.stringify({result:choose(query)}),{status:200,headers:{'content-type':'application/json'}});
 }) as typeof fetch};
}
describe('gallery collision preflight',()=>{
 it('allows an exact seeded rerun without silently reseeding or changing rule',async()=>{
  const ds=shuffledDocuments();
  for(const patch of [{},{orderingSeed:'rotated-seed'},{orderingRule:'manual',orderingSeed:null}]){
    const result=await runCollisionPreflight(connection,ds,new Map([['travel','real-travel']]),mockRows(q=>q.includes('orderingRule, orderingSeed, sections')?[{_id:'migrated--gallery-trip-fi',language:'fi',slug:'trip',canonicalCategoryId:'travel',orderingRule:'seeded-random',orderingSeed:'synthetic-gallery-v1',...patch}]:[]));
    if(Object.keys(patch).length)expect(result.collisions.join(' ')).toContain('incompatible ordering');
    else expect(result.collisions).toEqual([]);
  }
 });
 it('rejects an article claiming the gallery identity in a different language',async()=>{
  const result=await runCollisionPreflight(connection,documents(),new Map([['travel','real-travel']]),mockRows(q=>q.includes('contentId in $ids')?[{_id:'existing',_type:'article',contentId:'trip',language:'de'}]:[]));
  expect(result.collisions.join(' ')).toContain('variant cannot change');
 });
 it('allows the same curated occurrence in an independently migrated third language',async()=>{
  const result=await runCollisionPreflight(connection,documents(),new Map([['travel','real-travel']]),mockRows(q=>q.includes('placementId in $ids')?[{_id:'other-de',_type:'galleryPlacement',placementId:'occurrence-one',mediaRef:'migrated--media-photo',galleryContentId:'trip',galleryLanguage:'de',sectionId:'one'}]:[]));
  expect(result.collisions).toEqual([]);
 });
 it('rejects an extra same-language occurrence even when another language is also planned',async()=>{
  const result=await runCollisionPreflight(connection,documents(),new Map([['travel','real-travel']]),mockRows(q=>q.includes('placementId in $ids')?[{_id:'other-fi',_type:'galleryPlacement',placementId:'occurrence-one',mediaRef:'migrated--media-photo',galleryContentId:'trip',galleryLanguage:'fi',sectionId:'one'}]:[]));
  expect(result.collisions.join(' ')).toContain('placementId');
 });
});


describe('curated review approval binding', () => {
  const input = () => ({documents: documents(), assetRequirements: plan().assetRequirements,
    categoryRequirements: plan().categoryRequirements, sourceEvidenceDigest: 'b'.repeat(64)});
  const approve = (reviewDigest: string) => ({reviewDigest, approvedBy:'Owner',
    approvedAt:'2026-09-19T12:00:00Z', approvedForImport:true as const});
  it('keeps an unapproved review blocked even though its document graph is valid', () => {
    const result = buildCuratedGalleryPlan(input());
    expect(result.plan.documents).toHaveLength(5);
    expect(result.plan.errors).toHaveLength(1);
    expect(result.plan.errors[0]).toContain('Owner approval');
    expect(result.plan.writable).toBe(false);
  });
  it('accepts exact explicit approval but leaves asset/category resolution to the writer', () => {
    const source=input(), review=buildCuratedGalleryPlan(source);
    const result=buildCuratedGalleryPlan(source,approve(review.reviewDigest));
    expect(result.plan.errors).toEqual([]);
    expect(result.plan.writable).toBe(false);
    expect(validatePlanContract(result.plan).issues).toEqual([]);
  });
  it.each(['document','pixels','locator','category','evidence'])('invalidates approval when %s changes', key => {
    const source=input(), approval=approve(buildCuratedGalleryPlan(source).reviewDigest);
    if(key==='document') source.documents[1]={...source.documents[1]!,title:'Changed'};
    if(key==='pixels') source.assetRequirements[0]!.contentHash='c'.repeat(64);
    if(key==='locator') source.assetRequirements[0]!.sourceLocator='changed.jpg';
    if(key==='category') source.categoryRequirements[0]!.categoryId='other';
    if(key==='evidence') source.sourceEvidenceDigest='d'.repeat(64);
    expect(buildCuratedGalleryPlan(source,approval).plan.errors.join(' ')).toContain('Owner approval');
  });
  it('never lets approval clear a structural error or a private-field injection', () => {
    const source=input();source.documents[1]={...source.documents[1]!,archiveLocator:'private'};
    const result=buildCuratedGalleryPlan(source,approve(buildCuratedGalleryPlan(source).reviewDigest));
    expect(result.plan.errors.join(' ')).toContain('unrecognized field');
    expect(result.plan.documents).toEqual([]);
  });
  it('rejects invalid approval dates', () => {
    const source=input(), approval=approve(buildCuratedGalleryPlan(source).reviewDigest);
    approval.approvedAt='2026-02-30T12:00:00Z';
    expect(buildCuratedGalleryPlan(source,approval).plan.errors.join(' ')).toContain('Owner approval');
  });
});

// Exercises both owner-run CLIs with synthetic pixels and no live service.
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
it.each([documents,shuffledDocuments])('plans bilingual ordering and dry-runs the real writer with no credential %#', async(makeDocuments)=>{
 const dir=await mkdtemp(path.join(tmpdir(),'photosite-curated-cli-'));
 try {
  const image=await sharp({create:{width:240,height:160,channels:3,background:'#445566'}}).jpeg().toBuffer();
  const input={documents:makeDocuments(),assetRequirements:[{mediaId:'photo',sourceLocator:'photo.jpg',contentHash:createHash('sha256').update(image).digest('hex')}],categoryRequirements:[{categoryId:'travel'}],sourceEvidenceDigest:'c'.repeat(64)};
  const review=buildCuratedGalleryPlan(input);
  await writeFile(path.join(dir,'photo.jpg'),image);
  await writeFile(path.join(dir,'input.json'),JSON.stringify(input));
  await writeFile(path.join(dir,'approval.json'),JSON.stringify({reviewDigest:review.reviewDigest,approvedBy:'Synthetic fixture owner',approvedAt:'2026-09-19T12:00:00Z',approvedForImport:true}));
  const run=promisify(execFile);
  const env={...process.env,SANITY_MIGRATION_TOKEN:'',SANITY_PROJECT_ID:'',SANITY_DATASET:''};
  await run('node',[path.join(import.meta.dirname,'joomla-curated-gallery-plan.mts'),path.join(dir,'input.json'),path.join(dir,'plan.json'),path.join(dir,'approval.json')],{env});
  const plan=JSON.parse(await readFile(path.join(dir,'plan.json'),'utf8'));
  expect(plan.errors).toEqual([]);
  const result=await run('node',[path.join(import.meta.dirname,'write-joomla-content.mts'),'--plan',path.join(dir,'plan.json'),'--image-root',dir,'--out',path.join(dir,'report'),'--approved-digest',plan.documentsDigest],{env});
  expect(result.stdout).toContain('5 document(s)');
  expect(result.stdout).toContain('Dry run only');
 } finally {await rm(dir,{recursive:true,force:true});}
});

it('rejects changing the media of an existing curated placement even at the planned ID', async()=>{
 const result=await runCollisionPreflight(connection,documents(),new Map([['travel','real-travel']]),mockRows(q=>q.includes('placementId in $ids')?[{_id:'migrated--placement-one-fi',_type:'galleryPlacement',placementId:'occurrence-one',mediaRef:'another-image',galleryContentId:'trip',galleryLanguage:'fi',sectionId:'one'}]:[]));
 expect(result.collisions.join(' ')).toContain('placementId');
});
it('refuses an incompatible existing gallery ordering before rewriting the gallery', async()=>{
 const result=await runCollisionPreflight(connection,documents(),new Map([['travel','real-travel']]),mockRows(q=>q.includes('orderingRule, orderingSeed, sections')?[{_id:'migrated--gallery-trip-fi',language:'fi',slug:'trip',canonicalCategoryId:'travel',orderingRule:'seeded-random',orderingSeed:'original'}]:[]));
 expect(result.collisions.join(' ')).toContain('incompatible ordering');
});
it('requires the reviewed cover to remain public',()=>{
 const ds=documents();ds[0]={...ds[0]!,publiclyRenderable:false};
 expect(validateCuratedGalleryDocuments(ds).join(' ')).toContain('cover must resolve to a public image');
});

describe('existing curated gallery contents', () => {
 it.each([
  [{sectionId:'one',slug:'renamed'}],
  [{sectionId:'removed',slug:'gone'}],
 ])('refuses retiring published section URLs (%j)', async section => {
  const result = await runCollisionPreflight(connection,documents(),new Map([['travel','real-travel']]),mockRows(q => q.includes('orderingRule, orderingSeed, sections') ? [{_id:'migrated--gallery-trip-fi',language:'fi',slug:'trip',canonicalCategoryId:'travel',orderingRule:'manual',sections:[section]}] : []));
  expect(result.collisions.join(' ')).toContain('published section');
 });
 it('refuses target-only placements', async () => {
  const result = await runCollisionPreflight(connection,documents(),new Map([['travel','real-travel']]),mockRows(q => q.includes('gallery._ref in $ids') ? [{_id:'target-only',galleryRef:'migrated--gallery-trip-fi'}] : []));
  expect(result.collisions.join(' ')).toContain('unplanned placement');
 });
 it('permits exact section and placement reruns', async () => {
  const ds=documents();
  const result = await runCollisionPreflight(connection,ds,new Map([['travel','real-travel']]),mockRows(q => q.includes('gallery._ref in $ids') ? ds.filter(d=>d._type==='galleryPlacement').map(d=>({_id:d._id,galleryRef:(d.gallery as {_ref:string})._ref})) : q.includes('orderingRule, orderingSeed, sections') ? [{_id:'migrated--gallery-trip-fi',language:'fi',slug:'trip',canonicalCategoryId:'travel',orderingRule:'manual',sections:ds[1]!.sections}] : []));
  expect(result.collisions).toEqual([]);
 });
});

describe('curated gallery secondary category invariants', () => {
 it.each([
  {secondaryCategories:[ref('migrated-pending-category:travel')], expected:'canonical category cannot'},
  {secondaryCategories:[ref('migrated-pending-category:other'),ref('migrated-pending-category:other')], expected:'duplicate secondary'},
  {secondaryCategories:[{}], expected:'must contain references'},
 ])('rejects invalid secondary placement: $expected', ({secondaryCategories,expected}) => {
  const ds=documents();ds[1]={...ds[1]!,secondaryCategories};
  expect(validateMigrationDocuments(ds).join(' ')).toContain(expected);
 });
 it('allows story-root placement with distinct secondary categories', () => {
  const ds=documents();ds[1]={...ds[1]!,canonicalAtStoryRoot:true,canonicalCategory:undefined,secondaryCategories:[{...ref('migrated-pending-category:travel'),_key:'travel'}]};
  expect(validateMigrationDocuments(ds)).toEqual([]);
 });
});

it.each(["publishedAt", "eventDate", "endDate"])("refuses reader-unsupported calendar years in copied %s", (field) => {
  const ds = documents(); ds[1] = { ...ds[1]!, [field]: "0099-12-31T23:00:00-01:00" };
  expect(validateCuratedGalleryDocuments(ds).join(" ")).toContain("supported by the public reader");
  if (field !== "endDate") expect(validateMigrationDocuments(ds).join(" ")).toContain("supported by the public reader");
});


describe("private curated output permissions (AB#247)", () => {
  async function workspace(check: (dir: string) => Promise<void>) {
    const { mkdtemp, rm } = await import("node:fs/promises"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "curated-permissions-")); const exitCode = process.exitCode; const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try { await check(dir); } finally { process.exitCode = exitCode; log.mockRestore(); await rm(dir, { recursive: true, force: true }); }
  }
  const input = () => ({ documents: documents(), assetRequirements: plan().assetRequirements, categoryRequirements: plan().categoryRequirements, sourceEvidenceDigest: "b".repeat(64) });
  it.runIf(process.platform !== "win32").each([undefined, 0o644, 0o666])("makes new and existing mode %s output private and fully replaces bytes", async mode => {
    await workspace(async dir => {
      const { writeFile, readFile, stat, chmod } = await import("node:fs/promises"); const source = dir + "/input.json", output = dir + "/out.json"; const value = input();
      await writeFile(source, JSON.stringify(value)); if (mode !== undefined) { await writeFile(output, "old".repeat(10000)); await chmod(output, mode); }
      await runCuratedPlanner([source, output]);
      expect((await stat(output)).mode & 0o777).toBe(0o600); expect(await readFile(output, "utf8")).toBe(JSON.stringify(buildCuratedGalleryPlan(value).plan, null, 2) + "\n");
    });
  });
  it.runIf(process.platform !== "win32")("preserves output bytes and mode when input or approval parsing fails", async () => {
    await workspace(async dir => {
      const { writeFile, readFile, stat, chmod } = await import("node:fs/promises"); const source = dir + "/input.json", output = dir + "/out.json", approval = dir + "/approval.json";
      await writeFile(output, "existing"); await chmod(output, 0o644); await writeFile(source, "invalid");
      await expect(runCuratedPlanner([source, output])).rejects.toThrow();
      await writeFile(source, JSON.stringify(input())); await writeFile(approval, "invalid"); await expect(runCuratedPlanner([source, output, approval])).rejects.toThrow();
      expect(await readFile(output, "utf8")).toBe("existing"); expect((await stat(output)).mode & 0o777).toBe(0o644);
    });
  });
  it.runIf(process.platform !== "win32")("retains existing symlink target behavior with private target permissions", async () => {
    await workspace(async dir => {
      const { writeFile, readFile, stat, chmod, symlink, lstat } = await import("node:fs/promises"); const source = dir + "/input.json", target = dir + "/target.json", link = dir + "/out.json";
      await writeFile(source, JSON.stringify(input())); await writeFile(target, "old"); await chmod(target, 0o644); await symlink(target, link); await runCuratedPlanner([source, link]);
      expect((await lstat(link)).isSymbolicLink()).toBe(true); expect((await stat(target)).mode & 0o777).toBe(0o600); expect(await readFile(target, "utf8")).not.toBe("old");
    });
  });
  it.runIf(process.platform === "linux")("retains writing to a non-regular FIFO target without truncating it", async () => {
    await workspace(async dir => {
      const { open, writeFile, chmod, constants, stat } = await import("node:fs/promises");
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const source = dir + "/input.json", output = dir + "/output.pipe", value = input();
      await writeFile(source, JSON.stringify(value));
      await promisify(execFile)("mkfifo", [output]);
      await chmod(output, 0o640);
      const reader = await open(output, constants.O_RDWR | constants.O_NONBLOCK);
      const expected = Buffer.from(JSON.stringify(buildCuratedGalleryPlan(value).plan, null, 2) + "\n");
      const received = Buffer.alloc(expected.length);
      let writing: Promise<void> | undefined;
      try {
        writing = runCuratedPlanner([source, output]);
        let writeError: unknown;
        void writing.catch(error => { writeError = error; });
        const deadline = Date.now() + 4000;
        let offset = 0;
        while (offset < received.length) {
          if (writeError !== undefined) throw writeError;
          if (Date.now() >= deadline) throw new Error("FIFO plan read timed out");
          const { bytesRead } = await reader.read(received, offset, received.length - offset, null).catch(async error => {
            if (error.code !== "EAGAIN") throw error;
            await new Promise(resolve => setTimeout(resolve, 5));
            return { bytesRead: -1 };
          });
          if (bytesRead === -1) continue;
          if (bytesRead === 0) throw new Error("FIFO ended before the complete plan");
          offset += bytesRead;
        }
        await writing;
        expect(received).toEqual(expected);
        expect((await stat(output)).isFIFO()).toBe(true);
        expect((await stat(output)).mode & 0o777).toBe(0o640);
      } finally {
        await reader.close();
        await writing?.catch(() => {});
      }
    });
  });
  it.runIf(process.platform === "linux" && process.getuid?.() !== 0)("writes to a non-owned /dev/null device without changing its mode", async () => {
    await workspace(async dir => {
      const { writeFile, stat } = await import("node:fs/promises");
      const source = dir + "/input.json";
      await writeFile(source, JSON.stringify(input()));
      const before = (await stat("/dev/null")).mode;
      await expect(runCuratedPlanner([source, "/dev/null"])).resolves.toBeUndefined();
      expect((await stat("/dev/null")).mode).toBe(before);
    });
  });
});
