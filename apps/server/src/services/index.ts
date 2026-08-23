import type { Database } from "../db/index.ts";
import { AccessService } from "./access.ts";
import { IdentityService } from "./identities.ts";
import { MediaElementService } from "./media-elements.ts";
import { MediaObjectService } from "./media-objects.ts";
import { OperationService } from "./operations.ts";
import { OriginArtifactService } from "./origin-artifacts.ts";
import { VibeService } from "./vibes.ts";

export function createServices(db: Database) {
  const access = new AccessService(db);
  const identities = new IdentityService(db);
  const mediaObjects = new MediaObjectService(db, access, identities);
  return {
    access,
    identities,
    mediaElements: new MediaElementService(db, access),
    mediaObjects,
    operations: new OperationService(db, access),
    originArtifacts: new OriginArtifactService(db, access),
    vibes: new VibeService(db, access, identities, mediaObjects),
  };
}

export type Services = ReturnType<typeof createServices>;
