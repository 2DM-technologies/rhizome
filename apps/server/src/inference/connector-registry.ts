import type { InferenceConfig } from "./config.ts";
import { FakeModelConnector } from "./fake-connector.ts";
import {
  modelIdentity,
  parseModelTarget,
  type ModelConnector,
  type ModelTarget,
} from "./model-connector.ts";
import { OpenAIConnector } from "./openai/connector.ts";

export interface ModelConnectorRegistry {
  target: ModelTarget;
  identity: string;
  connector: ModelConnector;
}
export function createModelConnectorRegistry(
  config: InferenceConfig | undefined,
): ModelConnectorRegistry | undefined {
  if (!config) return undefined;
  const target = parseModelTarget(config.defaultTarget);
  let connector: ModelConnector | undefined;
  if (config.useFake) {
    if (process.env.NODE_ENV === "production")
      throw new Error("Fake inference is forbidden in production");
    connector = new FakeModelConnector();
  } else if (config.openai) {
    connector = new OpenAIConnector(config.openai);
  }
  if (!connector) return undefined;
  if (
    connector.provider !== target.provider ||
    !(connector.models as readonly string[]).includes(target.name)
  )
    throw new Error("Configured inference connector does not serve the default target");
  return { target, identity: modelIdentity(target), connector };
}
