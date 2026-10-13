import { useMemo } from "react";
import { definePlugin, SourceProvider, WorkspaceProvider, useWorkspace, useSource, useCurrentLocale, type LayoutProps } from "sanity";
import { localizedSchema } from "./localized-schema";

/** Pinned SDK bridge: SourceProvider/useSource are internal exports in 6.18.0. */
export function LocalizedLayout(props: LayoutProps) {
  const source = useSource();
  const workspace = useWorkspace();
  const { id } = useCurrentLocale();
  const localized = useMemo(() => ({ ...source, schema: localizedSchema(source.schema, id) }), [source, id]);
  // Inner list/document providers resolve the selected source from the workspace.
  const localizedWorkspace = useMemo(() => ({ ...workspace,
    unstable_sources: workspace.unstable_sources.map((item) => item.name === source.name ? localized : item),
  }), [workspace, source.name, localized]);
  return <WorkspaceProvider workspace={localizedWorkspace}>
    <SourceProvider source={localized}>{props.renderDefault(props)}</SourceProvider>
  </WorkspaceProvider>;
}

export const localizedPresentation = definePlugin({
  name: "photosite-localized-presentation",
  studio: { components: { layout: LocalizedLayout } },
});
