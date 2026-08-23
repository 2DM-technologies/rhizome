export function uriId(uri: string): string {
  const slash = uri.lastIndexOf("/");
  return slash >= 0 ? uri.slice(slash + 1) : uri;
}
