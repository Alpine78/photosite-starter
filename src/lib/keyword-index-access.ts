/** The deployment's keyword index. One read per request, shared by everything that renders it. */

import "server-only";

import { cache } from "react";

import { dispatchContentSource } from "@/lib/content-source";
import { getDeploymentConfig } from "@/lib/deployment-config";
import type { KeywordIndex } from "@/lib/keyword-index";
import { getMockKeywordIndex } from "@/lib/mock-keyword-gallery";
import { readSanityKeywordIndex } from "@/lib/sanity-keyword-index";

export const getKeywordIndex = cache((locale: string): Promise<KeywordIndex> =>
  dispatchContentSource(getDeploymentConfig().contentSource, {
    sanity: () => readSanityKeywordIndex({ language: locale }),
    mock: async () => getMockKeywordIndex(locale.split("-")[0]),
  }));
