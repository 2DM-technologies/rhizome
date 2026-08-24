import { Hono, type Handler, type MiddlewareHandler } from "hono";

import {
  rnetRoute,
  type ContractRequest,
  type ContractResponses,
  type OpenApiRouteContract,
  type RnetRouteHandler,
  type RouteAuth,
  type RouteContract,
} from "./contracts.ts";
import type { AppEnvironment } from "./types.ts";

export interface RegisteredRnetRoute {
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
  handler: RnetRouteHandler<Auth, Request, Path>,
) => void;

export interface RnetRouter {
  readonly hono: Hono<AppEnvironment>;
  readonly routes: RegisteredRnetRoute[];
  readonly delete: RegisterRoute;
  readonly get: RegisterRoute;
  readonly patch: RegisterRoute;
  readonly post: RegisterRoute;
  readonly put: RegisterRoute;
}

export function createRnetRouter(): RnetRouter {
  const hono = new Hono<AppEnvironment>();
  const routes: RegisteredRnetRoute[] = [];

  function register(method: string): RegisterRoute {
    return (path, contract, handler) => {
      routes.push({ method, path, contract: contract as OpenApiRouteContract });
      hono.on(
        method,
        path,
        rnetRoute(contract) as unknown as MiddlewareHandler<AppEnvironment>,
        handler as unknown as Handler<AppEnvironment>,
      );
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
