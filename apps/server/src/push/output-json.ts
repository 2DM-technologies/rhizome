/** PostgreSQL jsonb cannot store NUL or unpaired UTF-16 surrogates, even as JSON escapes. */
export function isDatabaseJson(value: unknown): boolean {
  if (typeof value === "string") {
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code === 0 || (code >= 0xdc00 && code <= 0xdfff)) return false;
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++index);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      }
    }
    return true;
  }
  if (Array.isArray(value)) return value.every(isDatabaseJson);
  if (value && typeof value === "object")
    return Object.entries(value).every(
      ([key, item]) => isDatabaseJson(key) && isDatabaseJson(item),
    );
  return true;
}
