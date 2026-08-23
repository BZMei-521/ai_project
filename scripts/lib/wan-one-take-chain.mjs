export function buildOneTakeSegments({ initialFramePath, prompts, baseSeed }) {
  if (!initialFramePath?.trim()) throw new Error("initialFramePath is required");
  if (!Array.isArray(prompts) || prompts.length !== 6) throw new Error("exactly six prompts are required");
  return prompts.map((prompt, index) => ({
    id: `segment_${String(index + 1).padStart(3, "0")}`,
    order: index + 1,
    prompt,
    seed: baseSeed + index + 1,
    input: index === 0
      ? { kind: "initial_frame", path: initialFramePath }
      : { kind: "previous_final_frame", fromSegmentId: `segment_${String(index).padStart(3, "0")}` }
  }));
}

export function assertBoundaryHash(previousFinalHash, nextInputHash, segmentId) {
  if (!previousFinalHash || previousFinalHash !== nextInputHash) {
    throw new Error(`boundary hash mismatch for ${segmentId}: ${previousFinalHash} != ${nextInputHash}`);
  }
}

export function buildOneTakeConcatFilter({ segmentCount, framesPerSegment, inputFps, outputFps }) {
  const filters = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const startFrame = index === 0 ? 0 : 1;
    filters.push(
      `[${index}:v]fps=${inputFps},trim=start_frame=${startFrame}:end_frame=${framesPerSegment},setpts=PTS-STARTPTS[v${index}]`
    );
  }
  const inputs = Array.from({ length: segmentCount }, (_, index) => `[v${index}]`).join("");
  filters.push(`${inputs}concat=n=${segmentCount}:v=1:a=0[native]`);
  filters.push(`[native]minterpolate=fps=${outputFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,format=yuv420p[outv]`);
  return {
    filterGraph: filters.join(";"),
    nativeFrameCount: framesPerSegment + (segmentCount - 1) * (framesPerSegment - 1)
  };
}
