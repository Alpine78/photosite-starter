"use client";

import { createContext, useContext } from "react";

export type PageErrorLabels = { readonly title: string; readonly message: string; readonly retry: string };
const Context = createContext<PageErrorLabels | undefined>(undefined);

export function PageErrorLabelsProvider({ labels, children }: { labels: PageErrorLabels; children: React.ReactNode }) {
  return <Context.Provider value={labels}>{children}</Context.Provider>;
}

export function usePageErrorLabels(): PageErrorLabels | undefined {
  return useContext(Context);
}
