const DATABASE = "rhizome.orb-rasters";
const STORE = "images";
const MAX_ENTRIES = 128;
const MAX_BYTES = 16 * 1024 * 1024;

interface CachedRaster {
  key: string;
  blob: Blob;
  usedAt: number;
}

let database: Promise<IDBDatabase | null> | undefined;

/** A disposable cache: unavailable storage must never prevent an orb from rendering. */
function openCache(): Promise<IDBDatabase | null> {
  return (database ??= new Promise((resolve) => {
    let settled = false;
    const finish = (value: IDBDatabase | null) => {
      if (settled) {
        value?.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), 1500);
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("usedAt", "usedAt");
      };
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        finish(db);
      };
    } catch {
      finish(null);
    }
  }));
}

export async function readOrbRaster(key: string): Promise<Blob | null> {
  const db = await openCache();
  if (!db) return null;
  try {
    return await new Promise<Blob | null>((resolve) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const request = store.get(key);
      let blob: Blob | null = null;
      request.onsuccess = () => {
        const entry = request.result as CachedRaster | undefined;
        if (entry?.blob instanceof Blob && entry.blob.type === "image/png") {
          blob = entry.blob;
          store.put({ ...entry, usedAt: Date.now() });
        }
      };
      transaction.oncomplete = () => resolve(blob);
      transaction.onabort = () => resolve(null);
      transaction.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function writeOrbRaster(key: string, blob: Blob): Promise<void> {
  const db = await openCache();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      store.put({ key, blob, usedAt: Date.now() } satisfies CachedRaster);
      // Keep the most recently used images, bounded by both count and encoded bytes.
      const request = store.index("usedAt").openCursor(null, "prev");
      let count = 0;
      let bytes = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const entry = cursor.value as CachedRaster;
        count += 1;
        bytes += entry.blob.size;
        if (count > MAX_ENTRIES || bytes > MAX_BYTES) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => resolve();
      transaction.onerror = () => resolve();
    });
  } catch {
    // Storage can be blocked or full; the in-memory image is still usable.
  }
}
