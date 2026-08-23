import assert from "node:assert/strict";
import { extractVideoOutputs } from "./lib/comfy-output-media.mjs";

const history = {
  outputs: {
    14: {
      images: [
        {
          filename: "river_continuity_001_wan21_i2v_00001_.mp4",
          subfolder: "Video",
          type: "output"
        }
      ],
      animated: [true]
    }
  }
};

assert.deepEqual(extractVideoOutputs(history), [
  {
    nodeId: "14",
    filename: "river_continuity_001_wan21_i2v_00001_.mp4",
    subfolder: "Video",
    type: "output"
  }
]);

console.log("Comfy core SaveVideo output extraction: PASS");
