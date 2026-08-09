export type CharacterSpeciesId = "human" | "beastfolk" | "catfolk" | "foxfolk" | "wolffolk";
export type CharacterSpeciesResolution =
  | { ok: true; species: CharacterSpeciesId; source: "identity" | "script_label" | "default_human" }
  | { ok: false; reason: "species_metadata_conflict" };
export type CharacterStyleContract = {
  id: "cinematic_3d_donghua_v1";
  version: "1.0.0";
  positivePrompt: string;
  negativePrompt: string;
};

export type CharacterStyleTokenInput = {
  tokens: Record<string, string | undefined>;
  kind: "image" | "video";
  characters?: Array<{
    name?: string;
    species?: CharacterSpeciesId;
    explicitLabels?: string[];
    speciesTraits?: string[];
  }>;
  contract?: CharacterStyleContract;
};

// The executable implementation is shared with the stock-Node focused check.
// @ts-expect-error The JavaScript runtime is intentionally dependency-free.
import { CINEMATIC_3D_DONGHUA_CONTRACT as runtimeContract, applyCharacterStyleContractToTokens as runtimeApply, buildCharacterSpeciesClauses as runtimeBuildClauses, computeCharacterStyleContractDigest as runtimeDigest, resolveCharacterSpecies as runtimeResolve } from "./characterStyleContractRuntime.mjs";

export const CINEMATIC_3D_DONGHUA_CONTRACT = runtimeContract as CharacterStyleContract;
export const computeCharacterStyleContractDigest = runtimeDigest as (contract: CharacterStyleContract) => string;
export const resolveCharacterSpecies = runtimeResolve as (input: {
  identitySpecies?: CharacterSpeciesId;
  explicitLabels?: string[];
}) => CharacterSpeciesResolution;
export const buildCharacterSpeciesClauses = runtimeBuildClauses as (result: CharacterSpeciesResolution) => {
  positive: string;
  negative: string;
};
export const applyCharacterStyleContractToTokens = runtimeApply as (input: CharacterStyleTokenInput) => Record<string, string | undefined>;
