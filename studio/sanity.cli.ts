import { defineCliConfig } from "sanity/cli";
import { fileURLToPath } from "node:url";

export default defineCliConfig({
  api: {
    projectId: process.env.SANITY_STUDIO_PROJECT_ID,
    dataset: process.env.SANITY_STUDIO_DATASET,
  },
  studioHost: process.env.SANITY_STUDIO_HOSTNAME,
  deployment: {
    appId: process.env.SANITY_STUDIO_APP_ID,
    autoUpdates: false,
  },
  // The SDK does not pass localized accessibility props to its array DndContext.
  // Exact alias: the bridge re-exports the native module and keeps its contexts.
  vite: (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      alias: [
        { find: /^@dnd-kit\/core$/, replacement: fileURLToPath(new URL("./localized-dnd-context.tsx", import.meta.url)) },
        ...(Array.isArray(config.resolve?.alias) ? config.resolve.alias
          : Object.entries(config.resolve?.alias ?? {}).map(([find, replacement]) => ({ find, replacement }))),
      ],
    },
  }),
});
