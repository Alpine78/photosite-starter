import { buildCuratedGalleryPlan } from './joomla-curated-gallery-plan.mts';
import { describe, it, expect } from 'vitest';
import { validateCuratedGalleryDocuments } from './joomla-curated-gallery.mts';
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
describe('curated gallery migration',()=>{
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
it('plans approved bilingual galleries and dry-runs the real writer with no credential', async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'photosite-curated-cli-'));
 try {
  const image=await sharp({create:{width:240,height:160,channels:3,background:'#445566'}}).jpeg().toBuffer();
  const input={documents:documents(),assetRequirements:[{mediaId:'photo',sourceLocator:'photo.jpg',contentHash:createHash('sha256').update(image).digest('hex')}],categoryRequirements:[{categoryId:'travel'}],sourceEvidenceDigest:'c'.repeat(64)};
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
  {galleryLayout:'masonry'},
  {galleryCaptionPlacement:'overlay'},
  {sections:[{sectionId:'one',slug:'first',intro:[{_type:'sectionIntroParagraph',spans:[{text:'Keep this introduction'}]}]}]},
 ])('refuses erasing editor-owned gallery fields on rerun: %j', async fields => {
  const result = await runCollisionPreflight(connection,documents(),new Map([['travel','real-travel']]),mockRows(q => {
   if (!q.includes('orderingRule, orderingSeed, sections')) return [];
   expect(q).toContain('galleryLayout');
   expect(q).toContain('galleryCaptionPlacement');
   return [{_id:'migrated--gallery-trip-fi',language:'fi',slug:'trip',canonicalCategoryId:'travel',orderingRule:'manual',...fields}];
  }));
  expect(result.collisions.join(' ')).toContain('editor-owned');
 });
 it('allows absent presentation overrides and section introductions', async () => {
  const result = await runCollisionPreflight(connection,documents(),new Map([['travel','real-travel']]),mockRows(q => q.includes('orderingRule, orderingSeed, sections') ? [{_id:'migrated--gallery-trip-fi',language:'fi',slug:'trip',canonicalCategoryId:'travel',orderingRule:'manual',galleryLayout:null,galleryCaptionPlacement:null,sections:[{sectionId:'one',slug:'first',intro:null}]}] : []));
  expect(result.collisions).toEqual([]);
 });
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
