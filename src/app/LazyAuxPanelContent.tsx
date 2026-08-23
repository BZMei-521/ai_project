import { Suspense, lazy, type ComponentType, type ReactNode } from "react";

type AuxPanelSection = "shots" | "inspector" | "layers" | "audio" | "assets" | "health" | "pipeline";
type StandardAuxPanelSection = Exclude<AuxPanelSection, "pipeline">;

type AuxPanelModule = {
  default: ComponentType;
};

const panelLoaders: Record<StandardAuxPanelSection, () => Promise<AuxPanelModule>> = {
  shots: () =>
    import("../modules/editor-shell/ShotListPanel").then((module) => ({
      default: module.ShotListPanel
    })),
  inspector: () =>
    import("../modules/editor-shell/ShotInspectorPanel").then((module) => ({
      default: module.ShotInspectorPanel
    })),
  layers: () =>
    import("../modules/canvas-engine/LayerPanel").then((module) => ({
      default: module.LayerPanel
    })),
  audio: () =>
    import("../modules/preview-engine/AudioTrackPanel").then((module) => ({
      default: module.AudioTrackPanel
    })),
  assets: () =>
    import("../modules/asset-manager/AssetPanel").then((module) => ({
      default: module.AssetPanel
    })),
  health: () =>
    import("../modules/editor-shell/ProjectHealthPanel").then((module) => ({
      default: module.ProjectHealthPanel
    }))
};

const panelComponents: Record<StandardAuxPanelSection, ReturnType<typeof lazy>> = {
  shots: lazy(panelLoaders.shots),
  inspector: lazy(panelLoaders.inspector),
  layers: lazy(panelLoaders.layers),
  audio: lazy(panelLoaders.audio),
  assets: lazy(panelLoaders.assets),
  health: lazy(panelLoaders.health)
};

const PANEL_LABELS: Record<AuxPanelSection, string> = {
  shots: "shot list",
  inspector: "inspector",
  layers: "layers",
  audio: "audio",
  assets: "assets",
  health: "health",
  pipeline: "pipeline"
};

function AuxPanelLoadingState({ section }: { section: AuxPanelSection }) {
  return (
    <div className="aux-panel-loading" role="status">
      Loading {PANEL_LABELS[section]}...
    </div>
  );
}

function RenderAuxPanel({ section }: { section: StandardAuxPanelSection }) {
  const PanelComponent = panelComponents[section];
  return (
    <Suspense fallback={<AuxPanelLoadingState section={section} />}>
      <PanelComponent />
    </Suspense>
  );
}

export function preloadAuxPanel(section: AuxPanelSection) {
  if (section === "pipeline") return Promise.resolve();
  return panelLoaders[section]();
}

export function LazyAuxPanelContent({
  section,
  pipelineContent
}: {
  section: AuxPanelSection;
  pipelineContent?: ReactNode;
}) {
  return (
    <>
      {section === "shots" && <RenderAuxPanel section="shots" />}
      {section === "inspector" && <RenderAuxPanel section="inspector" />}
      {section === "layers" && <RenderAuxPanel section="layers" />}
      {section === "audio" && <RenderAuxPanel section="audio" />}
      {section === "assets" && <RenderAuxPanel section="assets" />}
      {section === "health" && <RenderAuxPanel section="health" />}
      {pipelineContent}
    </>
  );
}
