import { Hono, type Handler, type MiddlewareHandler } from "hono";

import {
  rhizomeRoute,
  type ContractRequest,
  type ContractResponses,
  type OpenApiRouteContract,
  type RhizomeRouteHandler,
  type RouteAuth,
  type RouteContract,
} from "./contracts.ts";
import type { AppEnvironment } from "./types.ts";

export interface RegisteredRhizomeRoute {
  contract: OpenApiRouteContract;
  method: string;
  path: string;
}

type RegisterRoute = <
  const Path extends string,
  Request extends ContractRequest | undefined,
  const Responses extends ContractResponses,
  const Auth extends RouteAuth | undefined = undefined,
>(
  path: Path,
  contract: RouteContract<Auth, Request, Responses>,
  handler: RhizomeRouteHandler<Auth, Request, Path>,
) => void;

export interface RhizomeRouter {
  readonly hono: Hono<AppEnvironment>;
  readonly routes: RegisteredRhizomeRoute[];
  readonly delete: RegisterRoute;
  readonly get: RegisterRoute;
  readonly patch: RegisterRoute;
  readonly post: RegisterRoute;
  readonly put: RegisterRoute;
}

export function createRhizomeRouter(): RhizomeRouter {
  const hono = new Hono<AppEnvironment>();
  const routes: RegisteredRhizomeRoute[] = [];

  function register(method: string): RegisterRoute {
    return (path, contract, handler) => {
      routes.push({ method, path, contract: contract as OpenApiRouteContract });
      const handlers = [
        ...(rhizomeRoute(contract) as unknown as MiddlewareHandler<AppEnvironment>[]),
        handler as unknown as Handler<AppEnvironment>,
      ];
      hono.on([method], [path], ...handlers);
    };
  }

  return {
    hono,
    routes,
    delete: register("DELETE"),
    get: register("GET"),
    patch: register("PATCH"),
    post: register("POST"),
    put: register("PUT"),
  };
}
