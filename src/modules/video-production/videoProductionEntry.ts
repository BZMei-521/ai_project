export interface VideoProductionGateway {
  generateShot(shotId: string): Promise<boolean>;
  generateBatch(shotIds: string[]): Promise<boolean>;
  recommendCloud(shotId: string): boolean;
  prepareCloudHandoff(shotId: string): Promise<boolean>;
  declineCloud(shotId: string): void;
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

export function recommendRunningHubCloudShot(shotId: string): boolean {
  if (!activeGateway) throw new Error("video_production_gateway_unavailable");
  return activeGateway.recommendCloud(shotId);
}

export async function prepareRunningHubCloudHandoff(shotId: string): Promise<boolean> {
  if (!activeGateway) throw new Error("video_production_gateway_unavailable");
  return activeGateway.prepareCloudHandoff(shotId);
}

export function declineRunningHubCloudShot(shotId: string): void {
  if (!activeGateway) throw new Error("video_production_gateway_unavailable");
  activeGateway.declineCloud(shotId);
}
