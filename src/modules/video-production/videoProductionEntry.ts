export interface VideoProductionGateway {
  generateShot(shotId: string): Promise<boolean>;
  generateBatch(shotIds: string[]): Promise<boolean>;
}

let activeGateway: VideoProductionGateway | undefined;

export function registerVideoProductionGateway(gateway: VideoProductionGateway): () => void {
  activeGateway = gateway;
  return () => { if (activeGateway === gateway) activeGateway = undefined; };
}

export async function generateQualityGatedVideoShot(shotId: string): Promise<boolean> {
  if (!activeGateway) throw new Error("video_production_gateway_unavailable");
  return activeGateway.generateShot(shotId);
}

export async function generateQualityGatedVideoBatch(shotIds: string[]): Promise<boolean> {
  if (!activeGateway) throw new Error("video_production_gateway_unavailable");
  const unique = [...new Set(shotIds.map((id) => id.trim()).filter(Boolean))];
  if (!unique.length) return true;
  return activeGateway.generateBatch(unique);
}
