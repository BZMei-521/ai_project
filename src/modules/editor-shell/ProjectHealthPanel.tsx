import { useMemo, useState } from "react";
import { invokeDesktopCommand, isDesktopRuntime } from "../platform/desktopBridge";
import { useStoryboardStore } from "../storyboard-core/store";
import { pushToast } from "../ui/toastStore";

type HealthIssue = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  fixLabel?: string;
  onFix?: () => void;
};

export function ProjectHealthPanel() {
  const shots = useStoryboardStore((state) => state.shots);
  const layers = useStoryboardStore((state) => state.layers);
  const audioTracks = useStoryboardStore((state) => state.audioTracks);
  const shotStrokes = useStoryboardStore((state) => state.shotStrokes);
  const activeLayerByShotId = useStoryboardStore((state) => state.activeLayerByShotId);
  const addLayerToShot = useStoryboardStore((state) => state.addLayerToShot);
  const removeAudioTrack = useStoryboardStore((state) => state.removeAudioTrack);
  const repairActiveLayerMap = useStoryboardStore((state) => state.repairActiveLayerMap);
  const repairStrokeLayerRefs = useStoryboardStore((state) => state.repairStrokeLayerRefs);

  const [missingPaths, setMissingPaths] = useState<string[]>([]);
  const [scanState, setScanState] = useState<string>("空闲");

  const onScanMissingAudio = async () => {
    if (!isDesktopRuntime()) {
      setScanState("仅桌面版可执行扫描");
      pushToast("仅桌面版可执行扫描", "warning");
      return;
    }

    try {
      setScanState("扫描中...");
      pushToast("开始扫描音频路径...", "info");
      const paths = audioTracks.map((track) => track.filePath).filter(Boolean);
      const missing = await invokeDesktopCommand<string[]>("find_missing_paths", { paths });
      setMissingPaths(missing);
      setScanState(`发现 ${missing.length} 个缺失路径`);
      pushToast(
        missing.length > 0 ? `扫描完成：发现 ${missing.length} 个缺失路径` : "扫描完成：未发现缺失路径",
        missing.length > 0 ? "warning" : "success"
      );
    } catch (error) {
      setScanState(`扫描失败：${String(error)}`);
      pushToast(`扫描失败：${String(error)}`, "error");
    }
  };

  const toSeverityLabel = (severity: HealthIssue["severity"]): string => {
    if (severity === "high") return "高";
    if (severity === "medium") return "中";
    return "低";
  };

  const onFixIssue = (issue: HealthIssue) => {
    if (!issue.onFix) return;
    issue.onFix();
    pushToast(`已执行修复：${issue.title}`, issue.severity === "high" ? "warning" : "success");
  };

  const issues = useMemo<HealthIssue[]>(() => {
    const byShot = new Map<string, string[]>();
    for (const layer of layers) {
      const arr = byShot.get(layer.shotId) ?? [];
      arr.push(layer.id);
      byShot.set(layer.shotId, arr);
    }

    const shotsWithoutLayers = shots.filter((shot) => (byShot.get(shot.id)?.length ?? 0) === 0);
    const invalidActiveLayerShots = shots.filter((shot) => {
      const active = activeLayerByShotId[shot.id];
      if (!active) return false;
      return !(byShot.get(shot.id) ?? []).includes(active);
    });

    let orphanStrokeRefCount = 0;
    for (const shot of shots) {
      const valid = new Set(byShot.get(shot.id) ?? []);
      for (const stroke of shotStrokes[shot.id] ?? []) {
        if (stroke.layerId && !valid.has(stroke.layerId)) {
          orphanStrokeRefCount += 1;
        }
      }
    }

    const emptyAudioTracks = audioTracks.filter((track) => !track.filePath.trim());
    const missingAudioTracks = audioTracks.filter((track) => missingPaths.includes(track.filePath));

    const list: HealthIssue[] = [];

    if (shotsWithoutLayers.length > 0) {
      list.push({
        id: "shots-without-layers",
        severity: "high",
        title: "镜头缺少图层",
        detail: `${shotsWithoutLayers.length} 个镜头没有图层，无法正常编辑。`,
        fixLabel: "全部补图层",
        onFix: () => shotsWithoutLayers.forEach((shot) => addLayerToShot(shot.id))
      });
    }

    if (invalidActiveLayerShots.length > 0) {
      list.push({
        id: "invalid-active-layer",
        severity: "medium",
        title: "活动图层无效",
        detail: `${invalidActiveLayerShots.length} 个镜头指向了不存在的活动图层。`,
        fixLabel: "修复活动图层映射",
        onFix: () => repairActiveLayerMap()
      });
    }

    if (orphanStrokeRefCount > 0) {
      list.push({
        id: "orphan-stroke-layer-ref",
        severity: "medium",
        title: "笔画图层引用丢失",
        detail: `${orphanStrokeRefCount} 条笔画引用了已删除图层。`,
        fixLabel: "修复笔画引用",
        onFix: () => repairStrokeLayerRefs()
      });
    }

    if (emptyAudioTracks.length > 0) {
      list.push({
        id: "empty-audio-path",
        severity: "low",
        title: "音轨路径为空",
        detail: `${emptyAudioTracks.length} 条音轨缺少文件路径。`,
        fixLabel: "移除空音轨",
        onFix: () => emptyAudioTracks.forEach((track) => removeAudioTrack(track.id))
      });
    }

    if (missingAudioTracks.length > 0) {
      list.push({
        id: "missing-audio-file",
        severity: "high",
        title: "音频文件丢失",
        detail: `${missingAudioTracks.length} 个音频文件在磁盘上不存在。`,
        fixLabel: "移除丢失音轨",
        onFix: () => missingAudioTracks.forEach((track) => removeAudioTrack(track.id))
      });
    }

    return list;
  }, [activeLayerByShotId, addLayerToShot, audioTracks, layers, missingPaths, removeAudioTrack, repairActiveLayerMap, repairStrokeLayerRefs, shotStrokes, shots]);

  return (
    <section className="panel health-panel">
      <header className="panel-header">
        <h2>项目健康检查</h2>
        <button onClick={onScanMissingAudio} type="button">执行扫描</button>
      </header>
      <div className="timeline-meta">{scanState}</div>
      <ul className="health-list">
        {issues.length === 0 && <li>未发现问题。</li>}
        {issues.map((issue) => (
          <li key={issue.id}>
            <div>
              <strong>[严重级别：{toSeverityLabel(issue.severity)}] {issue.title}</strong>
            </div>
            <div>{issue.detail}</div>
            {issue.onFix && issue.fixLabel && (
              <button onClick={() => onFixIssue(issue)} type="button">{issue.fixLabel}</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
