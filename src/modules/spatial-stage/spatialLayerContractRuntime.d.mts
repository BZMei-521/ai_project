import type { SpatialContractValidation, SpatialShotContract } from "./spatialLayerContract";

export declare function normalizeSpatialShotContract(value: unknown): SpatialShotContract;
export declare function orderedLayerIds(contract: SpatialShotContract): string[];
export declare function validateSpatialShotContract(contract: SpatialShotContract): SpatialContractValidation;
