import type { Context, Next } from "hono";

export const DEV_USER_UUID = "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47";
export const DEV_MACHINE_UUID = "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b48";

export type Actor =
  | { kind: "user"; uuid: string; subject: string }
  | { kind: "client"; uuid: string; name: string; subject: string }
  | { kind: "public"; subject: "public" };

export interface AppVariables {
  actor: Actor;
}

export async function devAuth(c: Context<{ Variables: AppVariables }>, next: Next): Promise<Response | void> {
  const authorization = c.req.header("Authorization");
  let actor: Actor;
  if (authorization === "Bearer dev:user") {
    actor = { kind: "user", uuid: DEV_USER_UUID, subject: `id:rnet://id/${DEV_USER_UUID}` };
  } else if (authorization === "Bearer dev:client:rbudget") {
    actor = { kind: "client", uuid: DEV_MACHINE_UUID, name: "rbudget", subject: "client:rbudget" };
  } else {
    actor = { kind: "public", subject: "public" };
  }
  c.set("actor", actor);
  await next();
}
