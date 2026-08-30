import { describe, expect, test } from "bun:test";

import {
  connectSimpleFinRequestSchema,
  SIMPLEFIN_CONNECTOR_VERSION,
  SIMPLEFIN_PARSER_NAME,
  SIMPLEFIN_PARSER_VERSION,
  SIMPLEFIN_SKILL_ID,
  simpleFinSourceConfigSchema,
} from "./contracts.ts";

describe("SimpleFIN skill contracts", () => {
  test("keeps provider identifiers and UI-independent input schemas with the skill", () => {
    expect(SIMPLEFIN_SKILL_ID).toBe("simplefin");
    expect(SIMPLEFIN_PARSER_NAME).toBe("simplefin");
    expect(SIMPLEFIN_PARSER_VERSION).toBe("simplefin@2.0.0");
    expect(SIMPLEFIN_CONNECTOR_VERSION).toBe("simplefin-connector@1.0.0");
    expect(connectSimpleFinRequestSchema.properties).toHaveProperty("setup_token");
    expect(simpleFinSourceConfigSchema.properties.accounts.minItems).toBe(1);
  });
});
