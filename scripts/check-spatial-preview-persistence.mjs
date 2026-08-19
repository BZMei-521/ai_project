import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile("src/app/App.tsx", "utf8");
const store = await readFile("src/modules/storyboard-core/store.ts", "utf8");

assert.match(app, /onSceneChange=\{updateSpatialScene\}/, "preview must persist scene edits through the store");
assert.match(app, /onSelectionChange=\{setSelectedSpatialObject\}/, "preview must persist spatial selection through the store");
assert.doesNotMatch(app, /onSceneChange=\{\(\)\s*=>\s*undefined\}/, "preview scene callback must not be a no-op");
assert.doesNotMatch(app, /onSelectionChange=\{\(\)\s*=>\s*undefined\}/, "preview selection callback must not be a no-op");
assert.match(store, /updateSpatialScene:\s*\(scene:\s*SpatialScene\)\s*=>\s*void/);
assert.match(store, /setSelectedSpatialObject:\s*\(objectId:\s*string\s*\|\s*null\)\s*=>\s*void/);
assert.match(store, /const spatialScenes = state\.spatialScenes\.some\(\(item\)\s*=>\s*item\.id\s*===\s*scene\.id\)/);
assert.match(store, /selectedSpatialObjectId:\s*state\.selectedSpatialObjectId/);

console.log("spatial preview persistence checks passed");
