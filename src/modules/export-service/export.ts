export type ExportPreset = {
  width: number;
  height: number;
  fps: number;
  codec: "h264";
  durationSeconds: number;
};

export const DEFAULT_EXPORT_PRESET: ExportPreset = {
  width: 1920,
  height: 1080,
  fps: 24,
  codec: "h264",
  durationSeconds: 3
};
