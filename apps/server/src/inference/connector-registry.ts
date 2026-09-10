import type { InferenceConfig } from "./config.ts";
import { FakeModelConnector } from "./fake-connector.ts";
import {
  modelIdentity,
  parseModelTarget,
  type ModelConnector,
  type ModelTarget,
} from "./model-connector.ts";

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
  if (!config.useFake) return undefined;
  if (process.env.NODE_ENV === "production")
    throw new Error("Fake inference is forbidden in production");
  const connector = new FakeModelConnector();
  if (
    connector.provider !== target.provider ||
    !(connector.models as readonly string[]).includes(target.name)
  )
    throw new Error("Configured inference connector does not serve the default target");
  return { target, identity: modelIdentity(target), connector };
}
