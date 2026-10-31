import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerStyleSheet } from "styled-components";
import { ThemeProvider, studioTheme } from "@sanity/ui";
import { ExistingClientWebImagesView, type ExistingImageViewProps } from "../existing-client-web-images-view";
import { ProofDeleteDialog, type ProofDeleteDialogProps } from "../proof-delete-dialog";
import { ProofReopenDialog, type ProofReopenDialogProps } from "../proof-reopen-dialog";
import { ProofReminderSettingsDialog, type ProofReminderSettingsDialogProps } from "../proof-reminder-settings-dialog";

/** Same UI provider used by Sanity's StudioThemeProvider; no auth or CMS IO. */
export function renderStudioMarkup(element: ReactElement, scheme: "light" | "dark" = "light") {
  const sheet = new ServerStyleSheet();
  try {
    const markup = renderToStaticMarkup(sheet.collectStyles(<ThemeProvider theme={studioTheme} scheme={scheme}>{element}</ThemeProvider>));
    return sheet.getStyleTags() + markup;
  } finally { sheet.seal(); }
}

export function renderExistingImages(props: ExistingImageViewProps, scheme?: "light" | "dark") {
  return renderStudioMarkup(<ExistingClientWebImagesView {...props} />, scheme);
}
export function renderProofDelete(props: ProofDeleteDialogProps, scheme?: "light" | "dark") {
  return renderStudioMarkup(<ProofDeleteDialog {...props} />, scheme);
}
export function renderProofReopen(props: ProofReopenDialogProps, scheme?: "light" | "dark") {
  return renderStudioMarkup(<ProofReopenDialog {...props} />, scheme);
}
export function renderProofReminderSettings(props: ProofReminderSettingsDialogProps, scheme?: "light" | "dark") {
  return renderStudioMarkup(<ProofReminderSettingsDialog {...props} />, scheme);
}
