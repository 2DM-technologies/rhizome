import { PUSH_TASK_REFS, storeTaskKey } from "@rhizome/store-contract";
import {
  composeVibeOrb,
  parseOrbIdentity,
  type WeightedOrbCharacter,
} from "@rhizome/store-contract/orb";
import type { PrepareVibeContextInput, TaskOutput } from "../../../task-catalog.ts";
import type { VibeContext } from "../../../context.ts";

export async function prepareVibeOrbContext({
  vibeUuid,
  records,
}: PrepareVibeContextInput): Promise<Record<string, unknown>> {
  const seed = new Bun.CryptoHasher("sha256")
    .update(`rhizome:vibe-orb:${vibeUuid}`)
    .digest("hex")
    .slice(0, 32);
  const members = new Map(records.map((record) => [record.object.uuid, record.object]));
  const contributions: WeightedOrbCharacter[] = [];
  for (const object of members.values()) {
    const identity = parseOrbIdentity(
      object.inferred[storeTaskKey(PUSH_TASK_REFS.orbIdentity.name)]?.properties,
    );
    // Membership has no importance field: every distinct media object contributes equally.
    if (identity) contributions.push({ id: object.uuid, character: identity, weight: 1 });
  }
  const recipe = composeVibeOrb(seed, contributions);
  return {
    recipe: recipe ?? {
      version: 3,
      seed,
      palette: [
        { color: "#aeb3b5", weight: 0.48 },
        { color: "#f4f4f1", weight: 0.32 },
        { color: "#596164", weight: 0.2 },
      ],
      contrast: 0.2,
      field: { grain: 0.08, warp: 0.32, anisotropy: 0.18 },
      surface: { depth: 0.5, glow: 0.3 },
      motion: { drift: 0.3, turbulence: 0.2, spin: 0.2 },
    },
    confidence: recipe ? contributions.length / members.size : 0,
  };
}

/** Always resolve locally, including the empty state; never fall through to a Vibe model call. */
export function deriveVibeOrb(context: VibeContext): TaskOutput {
  const prepared = context.task_context!;
  return { ...(prepared.recipe as TaskOutput), confidence: prepared.confidence };
}
