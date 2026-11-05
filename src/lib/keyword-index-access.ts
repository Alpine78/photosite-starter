/**
 * The deployment's keyword index. One read per request, shared by everything that renders it.
 *
 * Known limit: each read walks every page of closures, from the cache when it holds them, and then
 * rebuilds the index. Caching the built index would remove that, but nothing here caches a computed value yet.
 */

import "server-only";

import { cache } from "react";

import { dispatchContentSource } from "@/lib/content-source";
import { getDeploymentConfig } from "@/lib/deployment-config";
import type { KeywordIndex } from "@/lib/keyword-index";
import { getMockKeywordIndex } from "@/lib/mock-keyword-gallery";
import { readSanityKeywordIndex } from "@/lib/sanity-keyword-index";

/**
 * A visitor is waiting on every caller, and a cold cache means one request per 1000 media, one after another.
 * Past this the caller answers without the index.
 */
const KEYWORD_INDEX_READ_BUDGET_MS = 3000;

export async function getKeywordIndexWithinBudget(locale: string): Promise<KeywordIndex> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("the keyword index read past its budget")), KEYWORD_INDEX_READ_BUDGET_MS);
  });
  try {
    return await Promise.race([getKeywordIndex(locale), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export const getKeywordIndex = cache((locale: string): Promise<KeywordIndex> =>
  dispatchContentSource(getDeploymentConfig().contentSource, {
    sanity: () => readSanityKeywordIndex({ language: locale }),
    mock: async () => getMockKeywordIndex(locale.split("-")[0]),
  }));
