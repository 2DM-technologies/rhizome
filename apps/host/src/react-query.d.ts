import "@tanstack/react-query";

declare module "@tanstack/react-query" {
  interface Register {
    // API failures are generated Problem documents; transport failures are Error instances.
    defaultError: unknown;
  }
}
