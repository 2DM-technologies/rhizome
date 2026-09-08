import { describe, expect, test } from "bun:test";

import type { ParsedTransactions } from "../contracts.ts";
import { verifyTransactions } from "../verify.ts";
import { simpleFinSourceSkillManifest } from "./manifest.ts";
import { simpleFinParser } from "./parser.ts";
import {
  createSimpleFinSkill,
  filterSimpleFinTransactions,
  planSimpleFinHistory,
} from "./source.ts";

const allowedHost = "bridge.simplefin.test";

describe("SimpleFIN connected-source skill", () => {
  test("declares its parser, capture, connection, and credential-wide fetch policy", () => {
    const skill = createSimpleFinSkill({ allowedHosts: [allowedHost] });

    expect(skill.manifest).toBe(simpleFinSourceSkillManifest);

    expect(skill).toMatchObject({
      skillId: "simplefin",
      displayName: "SimpleFIN",
      manifest: {
        skill_id: "simplefin",
        source_kind: "credentialed_remote",
        connector_version: "simplefin-connector@1.0.0",
        parser: { name: "simplefin", version: "simplefin@2.0.0" },
        connection: {
          mode: "claim_exchange",
          claim_policy: { kind: "single_use_global" },
        },
        review_actions: ["review_import", "refresh_source"],
      },
      parser: simpleFinParser,
      fetchPolicy: { attempts: 24, windowHours: 24 },
      capture: { mime: "application/json" },
    });
    expect(skill.capture.label("fetch-1")).toBe("simplefin-fetch-1.json");
    if (skill.connection.mode !== "claim_exchange") throw new Error("Expected claim exchange");

    const claimUrl = `https://${allowedHost}/simplefin/claim/once`;
    const prepared = skill.connection.prepare({
      setup_token: Buffer.from(claimUrl).toString("base64"),
    });
    expect(prepared).toMatchObject({
      replayKey: claimUrl,
      fingerprintCompatibility: [
        {
          claim: claimUrl,
          localHkdfInfo: "rhizome:simplefin-setup-token-fingerprint:v1",
          kmsDigestDomain: "rhizome:simplefin-setup-token-fingerprint:kms-v1",
        },
      ],
    });
  });

  test("normalizes stored config and prepares an exact account request", async () => {
    const requests: URL[] = [];
    const skill = createSimpleFinSkill({
      allowedHosts: [allowedHost],
      fetch: async (input) => {
        requests.push(new URL(String(input)));
        return new Response('{"errlist":[],"connections":[],"accounts":[]}');
      },
    });
    const config = skill.parseConfig({
      accounts: [
        { connection_id: "conn-beta", account_id: "shared" },
        { connection_id: "conn-alpha", account_id: "other" },
      ],
      include_pending: true,
    });
    const fetch = await skill.prepareFetch({
      config,
      endDateEpoch: 1_800_000_000,
      limits: simpleFinSourceSkillManifest.limits,
    });

    await fetch.retrieve(`https://user:secret@${allowedHost}/simplefin`, {
      signal: new AbortController().signal,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.searchParams.get("start-date")).toBe(String(1_800_000_000 - 45 * 86_400));
    expect(requests[0]?.searchParams.get("end-date")).toBe("1800000000");
    expect(requests[0]?.searchParams.getAll("account")).toEqual(["other", "shared"]);
    expect(requests[0]?.searchParams.get("pending")).toBe("1");
    expect(fetch.compiledSource.kind).toBe("candidate_bundle@1");
    expect(() => skill.parseConfig({ include_pending: "yes" })).toThrow(
      "Stored SimpleFIN source configuration is invalid",
    );
  });

  test("cooperatively cancels an in-flight provider request", async () => {
    let providerSignal: AbortSignal | undefined;
    let providerSettled = false;
    const skill = createSimpleFinSkill({
      allowedHosts: [allowedHost],
      fetch: async (_input, init) => {
        providerSignal = init?.signal ?? undefined;
        if (!providerSignal) throw new Error("Expected a provider abort signal");
        return new Promise<Response>((_resolve, reject) => {
          const rejectOnAbort = () => {
            providerSettled = true;
            reject(providerSignal?.reason);
          };
          if (providerSignal?.aborted) rejectOnAbort();
          else providerSignal?.addEventListener("abort", rejectOnAbort, { once: true });
        });
      },
    });
    const prepared = await skill.prepareFetch({
      config: {},
      endDateEpoch: 1_800_000_000,
      limits: simpleFinSourceSkillManifest.limits,
    });
    const caller = new AbortController();
    const reason = new Error("retrieval cancelled");

    const retrieval = prepared.retrieve(`https://user:secret@${allowedHost}/simplefin`, {
      signal: caller.signal,
    });
    caller.abort(reason);

    await expect(retrieval).rejects.toBe(reason);
    expect(providerSignal?.aborted).toBe(true);
    expect(providerSettled).toBe(true);
  });

  test("extends one request beyond 45 days and requires reviewed recovery past 90 days", async () => {
    const day = 24 * 60 * 60;
    const endDateEpoch = 1_800_000_000;
    const previous = (balanceAtEpoch: number): ParsedTransactions => ({
      transactions: [],
      sourceRecordCount: 0,
      allowEmpty: true,
      accountBalances: [
        {
          accountIdentity: '["conn","account"]',
          currency: "USD",
          balance: "100.00",
          balanceAt: new Date(balanceAtEpoch * 1_000).toISOString(),
          balanceAtEpoch,
          sourceRecordCount: 0,
        },
      ],
    });

    expect(planSimpleFinHistory(undefined, endDateEpoch, false)).toEqual({
      startDateEpoch: endDateEpoch - 45 * day,
    });
    const covered = previous(endDateEpoch - 60 * day);
    expect(planSimpleFinHistory(covered, endDateEpoch, false)).toEqual({
      previous: covered,
      startDateEpoch: endDateEpoch - 75 * day,
    });

    const nearLimit = previous(endDateEpoch - 80 * day);
    expect(planSimpleFinHistory(nearLimit, endDateEpoch, false)).toEqual({
      previous: nearLimit,
      startDateEpoch: endDateEpoch - 90 * day,
    });

    const stale = previous(endDateEpoch - 100 * day);
    let requiredAction: unknown;
    try {
      planSimpleFinHistory(stale, endDateEpoch, false);
      throw new Error("expected history gap");
    } catch (error) {
      requiredAction = error;
      expect(error).toMatchObject({
        skillId: "simplefin",
        kind: "review_import",
        resume: { mode: "rebaseline" },
      });
    }
    expect(JSON.stringify(requiredAction)).not.toContain("source:");
    expect(JSON.stringify(requiredAction)).not.toContain(
      new Date((endDateEpoch - 100 * day) * 1_000).toISOString(),
    );
    expect(planSimpleFinHistory(stale, endDateEpoch, true)).toMatchObject({
      startDateEpoch: endDateEpoch - 45 * day,
      historyRecovery: {
        mode: "rebaseline",
        reason: "simplefin_history_gap",
        previous_balance_at: new Date((endDateEpoch - 100 * day) * 1_000).toISOString(),
        history_resumes_at: new Date((endDateEpoch - 45 * day) * 1_000).toISOString(),
      },
    });

    const skill = createSimpleFinSkill({ allowedHosts: [allowedHost] });
    const previousCapture = await fixtureBytes("accounts-previous-v2.json");
    const resumed = await skill.prepareFetch({
      config: {},
      endDateEpoch: 1_800_000_000,
      limits: simpleFinSourceSkillManifest.limits,
      previousCapture,
      resume: { mode: "rebaseline" },
    });
    expect(resumed.actionEvidence).toEqual({ kind: "review_import" });
    const resumedBundle = await resumed.compiledSource.compile({
      bytes: await fixtureBytes("accounts-current-v2.json"),
      limits: skill.manifest.limits,
    });
    expect(resumedBundle.verify).toMatchObject({ history_recovery: { mode: "rebaseline" } });
    await expect(
      skill.prepareFetch({
        config: {},
        endDateEpoch: 1_800_000_000,
        limits: simpleFinSourceSkillManifest.limits,
        previousCapture,
        resume: { mode: "unsupported" },
      }),
    ).rejects.toThrow("SimpleFIN continuation resume is invalid");
  });

  test("filters composite accounts and pending transactions deterministically", async () => {
    const parsed = await parseFixture("accounts-current-v2.json");
    const alpha = filterSimpleFinTransactions(parsed, {
      accounts: [{ connection_id: "conn-alpha", account_id: "acct-shared" }],
    });
    expect(alpha.transactions.map(({ fitid }) => fitid)).toEqual([
      "shared-transaction",
      "alpha-debit",
    ]);
    expect(alpha.sourceRecordCount).toBe(2);
    expect(alpha.accountBalances).toHaveLength(1);
    expect(alpha.accountBalances?.[0]?.sourceRecordCount).toBe(2);

    const withPending = filterSimpleFinTransactions(parsed, {
      accounts: [{ connection_id: "conn-alpha", account_id: "acct-shared" }],
      include_pending: true,
    });
    expect(withPending.transactions.map(({ fitid }) => fitid)).toEqual([
      "shared-transaction",
      "alpha-debit",
      "alpha-pending",
    ]);

    const bothConnections = filterSimpleFinTransactions(parsed, {
      accounts: [
        { connection_id: "conn-beta", account_id: "acct-shared" },
        { connection_id: "conn-alpha", account_id: "acct-shared" },
      ],
    });
    expect(
      bothConnections.transactions.map(({ accountIdentity, fitid }) => [accountIdentity, fitid]),
    ).toEqual([
      ['["conn-alpha","acct-shared"]', "shared-transaction"],
      ['["conn-alpha","acct-shared"]', "alpha-debit"],
      ['["conn-beta","acct-shared"]', "shared-transaction"],
    ]);

    expect(() =>
      filterSimpleFinTransactions(parsed, {
        accounts: [
          { connection_id: "conn-alpha", account_id: "acct-shared" },
          { connection_id: "conn-missing", account_id: "acct-shared" },
        ],
      }),
    ).toThrow("SimpleFIN response omitted 1 selected account");
  });

  test("owns balance-snapshot identity projection and reviewed verification recovery", async () => {
    const skill = createSimpleFinSkill({ allowedHosts: [allowedHost] });
    const previousCapture = await fixtureBytes("accounts-previous-v2.json");
    const currentCapture = await fixtureBytes("accounts-current-v2.json");
    const prepared = await skill.prepareFetch({
      config: {},
      endDateEpoch: 1_786_752_000,
      limits: simpleFinSourceSkillManifest.limits,
      previousCapture,
    });
    const bundle = await prepared.compiledSource.compile({
      bytes: currentCapture,
      limits: skill.manifest.limits,
    });
    const first = bundle.candidates[0]!;
    expect(first.sourceProperties).toMatchObject({
      account_balance: "1125.50",
      simplefin_account_extra: { account_kind: "synthetic-checking" },
    });
    expect(first.semanticSourceProperties).not.toHaveProperty("account_balance");
    expect(first.semanticSourceProperties).not.toHaveProperty("simplefin_account_extra");

    const mismatched = JSON.parse(new TextDecoder().decode(currentCapture)) as {
      accounts: Array<{ balance: string }>;
    };
    mismatched.accounts[0]!.balance = "1125.51";
    const report = (
      await prepared.compiledSource.compile({
        bytes: new TextEncoder().encode(JSON.stringify(mismatched)),
        limits: skill.manifest.limits,
      })
    ).verify;
    const action = prepared.compiledSource.verificationError?.(report);

    expect(action).toMatchObject({
      skillId: "simplefin",
      kind: "review_import",
      resume: { mode: "rebaseline" },
    });
  });
});

async function parseFixture(name: string): Promise<ParsedTransactions> {
  return simpleFinParser.parse(await fixtureBytes(name));
}

async function fixtureBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(
    await Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).arrayBuffer(),
  );
}
