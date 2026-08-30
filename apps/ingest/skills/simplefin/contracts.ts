export const SIMPLEFIN_SKILL_ID = "simplefin" as const;
export const SIMPLEFIN_PARSER_NAME = "simplefin" as const;
export const SIMPLEFIN_PARSER_VERSION = "simplefin@2.0.0" as const;
export const SIMPLEFIN_CONNECTOR_VERSION = "simplefin-connector@1.0.0" as const;

export const connectSimpleFinRequestSchema = {
  type: "object",
  required: ["setup_token"],
  properties: {
    setup_token: { type: "string", minLength: 1, maxLength: 8_192 },
  },
  additionalProperties: false,
} as const;

export interface ConnectSimpleFinRequest {
  setup_token: string;
}

export const simpleFinSourceConfigSchema = {
  type: "object",
  properties: {
    accounts: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: {
        type: "object",
        required: ["connection_id", "account_id"],
        properties: {
          connection_id: { type: "string", minLength: 1, maxLength: 512 },
          account_id: { type: "string", minLength: 1, maxLength: 512 },
        },
        additionalProperties: false,
      },
    },
    include_pending: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

export interface SimpleFinAccountSelector {
  connection_id: string;
  account_id: string;
}

export interface SimpleFinSourceConfig {
  accounts?: SimpleFinAccountSelector[];
  include_pending?: boolean;
}
