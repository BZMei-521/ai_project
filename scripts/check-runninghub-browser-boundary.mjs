import { build } from "esbuild";

await build({
  entryPoints: ["src/modules/video-production/VideoProductionPanel.tsx"],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  external: ["react", "react-dom", "@tauri-apps/api", "@tauri-apps/api/*"]
});

console.log("PASS RunningHub browser boundary excludes Node-only result importer");
