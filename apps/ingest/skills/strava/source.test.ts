import { describe, expect, test, spyOn } from "bun:test";
import { installedFileSourceSkills } from "../../src/source-skill-catalog.ts";
import { STRAVA_LIMITS } from "./contracts.ts";
import { activityCsv, representativeSyntheticExport } from "./fixtures/synthetic.ts";
import { stravaSourceSkill } from "./source.ts";

describe("Strava file source capability", () => {
  test("registers a generic reviewed file source and compiles facts with no network, owner, user or inferred writes", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => {
      throw new Error("Parser network access forbidden");
    }) as unknown as typeof fetch);
    try {
      const bytes = await representativeSyntheticExport();
      const bundle = await stravaSourceSkill.compiledSource.compile({
        bytes,
        limits: STRAVA_LIMITS,
      });
      expect(installedFileSourceSkills.forSkillId("strava")?.manifest.source_kind).toBe("file");
      expect(bundle.kind).toBe("candidate_bundle@1");
      expect(bundle.verify.ok).toBe(true);
      expect(bundle.candidates).toHaveLength(5);
      expect(
        bundle.candidates.every(
          (candidate) =>
            candidate.type === "fitness_activity" &&
            candidate.elements.length === 0 &&
            !("owner" in candidate) &&
            !("user" in candidate) &&
            !("inferred" in candidate),
        ),
      ).toBe(true);
      expect(bundle.candidates[0]!.keys).toEqual({ strava_activity_id: "9007199254740993123" });
      expect(bundle.candidates[0]!.semanticIdentity).toEqual({
        type: "fitness_activity",
        strava_activity_id: "9007199254740993123",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(
        await stravaSourceSkill.compiledSource.compile({ bytes, limits: STRAVA_LIMITS }),
      ).toEqual(bundle);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("empty running inventories fail VERIFY and effective persisted limits apply", async () => {
    const bundle = await stravaSourceSkill.compiledSource.compile({
      bytes: activityCsv([{ sport: "Ride" }]),
      limits: STRAVA_LIMITS,
    });
    expect(bundle.verify.ok).toBe(false);
    expect(bundle.candidates).toEqual([]);
    await expect(
      stravaSourceSkill.compiledSource.compile({
        bytes: activityCsv([{}, { id: "2" }]),
        limits: { ...STRAVA_LIMITS, maxCandidates: 1 },
      }),
    ).rejects.toThrow(/candidates/);
    await expect(
      stravaSourceSkill.compiledSource.compile({
        bytes: activityCsv([{}]),
        limits: { ...STRAVA_LIMITS, maxCaptureBytes: 1 },
      }),
    ).rejects.toThrow(/capture bytes/);
  });
});
