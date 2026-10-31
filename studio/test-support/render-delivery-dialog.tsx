import { renderToStaticMarkup } from "react-dom/server";
import { ServerStyleSheet } from "styled-components";
import { ThemeProvider, studioTheme } from "@sanity/ui";
import { DeliveryPublishDialog, type DeliveryPublishDialogProps } from "../client-gallery-publish-dialog";

/** Same UI provider used by Sanity's StudioThemeProvider; no auth or CMS IO. */
export function renderDeliveryDialog(props: DeliveryPublishDialogProps, scheme: "light" | "dark" = "light") {
  const sheet = new ServerStyleSheet();
  try {
    const markup = renderToStaticMarkup(sheet.collectStyles(
      <ThemeProvider theme={studioTheme} scheme={scheme}><DeliveryPublishDialog {...props} /></ThemeProvider>,
    ));
    return sheet.getStyleTags() + markup;
  } finally { sheet.seal(); }
}
