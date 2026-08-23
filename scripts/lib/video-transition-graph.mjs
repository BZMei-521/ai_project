function formatNumber(value) {
  return Number(value.toFixed(6)).toString();
}

export function buildXfadeGraph({ clipCount, clipDuration, transitionDuration, inputFps, outputFps }) {
  if (!Number.isInteger(clipCount) || clipCount < 2) throw new Error("clipCount must be at least 2");
  if (!(clipDuration > transitionDuration && transitionDuration > 0)) {
    throw new Error("transitionDuration must be positive and shorter than each clip");
  }

  const filters = [];
  for (let index = 0; index < clipCount; index += 1) {
    filters.push(`[${index}:v]fps=${inputFps},settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[v${index}]`);
  }

  const offsets = [];
  let previous = "v0";
  for (let index = 1; index < clipCount; index += 1) {
    const offset = index * (clipDuration - transitionDuration);
    offsets.push(Number(offset.toFixed(6)));
    const output = `x${index}`;
    filters.push(
      `[${previous}][v${index}]xfade=transition=fade:duration=${formatNumber(transitionDuration)}:offset=${formatNumber(offset)}[${output}]`
    );
    previous = output;
  }

  filters.push(
    `[${previous}]minterpolate=fps=${outputFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,format=yuv420p[outv]`
  );

  return {
    filterGraph: filters.join(";"),
    offsets,
    expectedDuration: Number((clipCount * clipDuration - (clipCount - 1) * transitionDuration).toFixed(6))
  };
}
