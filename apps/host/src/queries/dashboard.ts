import { api } from "../api/client.ts";

/** Live owner-scoped lifetime totals for the bare desktop. */
export function useDashboardStats() {
  return api.useQuery("get", "/rnet/v0/me/stats", undefined, {
    refetchOnWindowFocus: "always",
  });
}
