import { useStoryboardStore } from "../storyboard-core/store";
import { confirmDialog, promptDialog } from "../ui/dialogStore";

function formatTrackKind(kind?: string): string {
  switch (kind) {
    case "dialogue":
      return "对白";
    case "narration":
      return "旁白";
    case "ambience":
      return "环境";
    case "character_sfx":
      return "人物音效";
    case "prop_sfx":
      return "道具音效";
    default:
      return "手动";
  }
}

export function AudioTrackPanel() {
  const audioTracks = useStoryboardStore((state) => state.audioTracks);
  const addAudioTrack = useStoryboardStore((state) => state.addAudioTrack);
  const updateAudioTrack = useStoryboardStore((state) => state.updateAudioTrack);
  const removeAudioTrack = useStoryboardStore((state) => state.removeAudioTrack);

  const onAddTrack = async () => {
    const input = await promptDialog({
      title: "音频文件路径",
      placeholder: "/path/to/audio.wav",
      confirmText: "添加"
    });
    if (!input) return;
    const path = input.trim();
    if (!path) return;
    addAudioTrack(path);
  };
  const onRemoveTrack = async (trackId: string) => {
    const confirmed = await confirmDialog({
      title: "删除音轨",
      message: "确认删除该音轨吗？",
      confirmText: "删除",
      danger: true
    });
    if (!confirmed) return;
    removeAudioTrack(trackId);
  };

  return (
    <section className="panel audio-panel">
      <header className="panel-header">
        <h2>音轨</h2>
        <button onClick={onAddTrack} type="button">+ 添加音轨</button>
      </header>
      <ul className="audio-list">
        {audioTracks.length === 0 && <li>暂无音轨</li>}
        {audioTracks.map((track) => (
          <li key={track.id}>
            <div className="timeline-meta">
              {track.label?.trim() || "未命名音轨"} · {formatTrackKind(track.kind)}
            </div>
            <label>
              路径
              <input
                onChange={(event) =>
                  updateAudioTrack(track.id, { filePath: event.target.value })
                }
                type="text"
                value={track.filePath}
              />
            </label>
            <div className="audio-row">
              <label>
                起始帧
                <input
                  min={0}
                  onChange={(event) =>
                    updateAudioTrack(track.id, { startFrame: Number(event.target.value) })
                  }
                  type="number"
                  value={track.startFrame}
                />
              </label>
              <label>
                音量增益
                <input
                  min={0}
                  onChange={(event) =>
                    updateAudioTrack(track.id, { gain: Number(event.target.value) })
                  }
                  step={0.1}
                  type="number"
                  value={track.gain}
                />
              </label>
            </div>
            <button className="btn-danger" onClick={() => void onRemoveTrack(track.id)} type="button">删除</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
