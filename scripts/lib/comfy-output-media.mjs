export function extractVideoOutputs(history) {
  const videos = [];
  for (const [nodeId, output] of Object.entries(history.outputs || {})) {
    const media = [...(output.videos || []), ...(output.images || [])];
    for (const item of media) {
      if (typeof item?.filename === "string" && /\.(mp4|webm|mov|mkv)$/i.test(item.filename)) {
        videos.push({ nodeId, ...item });
      }
    }
  }
  return videos;
}
