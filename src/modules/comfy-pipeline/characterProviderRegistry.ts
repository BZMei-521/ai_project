export type CharacterGenerationProviderId = "qwen_image_edit_2511" | "flux2_klein_4b";
export type CharacterProviderAvailabilityReason = "license_blocked" | "missing_model" | "missing_node";

export type CharacterGenerationProviderDefinition = {
  id: CharacterGenerationProviderId;
  displayName: string;
  commercialUse: boolean;
  license: "Apache-2.0" | string;
  requiredModels: string[];
  requiredNodes: string[];
  referenceMode: "native_edit" | "multi_reference";
  score: number;
  hardwareNote: string;
};

export type CharacterProviderEnvironment = {
  commercialRequired?: boolean;
  models?: string[];
  nodes?: string[];
};

export type CharacterProviderInspection = {
  provider: CharacterGenerationProviderDefinition;
  available: boolean;
  reasons: CharacterProviderAvailabilityReason[];
  missingModels: string[];
  missingNodes: string[];
};

export type CharacterProviderSelection = {
  selected?: CharacterGenerationProviderDefinition;
  inspections: CharacterProviderInspection[];
};

// The executable implementation is shared with the stock-Node focused check.
// @ts-expect-error The JavaScript runtime is intentionally dependency-free.
import { CHARACTER_GENERATION_PROVIDERS as runtimeProviders, inspectCharacterProvider as runtimeInspect, selectCharacterProvider as runtimeSelect } from "./characterProviderRegistryRuntime.mjs";

export const CHARACTER_GENERATION_PROVIDERS = runtimeProviders as readonly CharacterGenerationProviderDefinition[];
export const inspectCharacterProvider = runtimeInspect as (
  provider: CharacterGenerationProviderDefinition,
  environment?: CharacterProviderEnvironment
) => CharacterProviderInspection;
export const selectCharacterProvider = runtimeSelect as (
  environment?: CharacterProviderEnvironment
) => CharacterProviderSelection;
