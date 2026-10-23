import "server-only";
import { getEnv } from "@/lib/env";
import { LocalStorageProvider } from "./local";
import type { StorageProvider } from "./types";
import { VercelBlobStorageProvider } from "./vercel-blob";

export * from "./types";

let provider: StorageProvider | undefined;

// Chosen by STORAGE_PROVIDER: "local" (private ./uploads, default) or "vercel-blob" (private access).
export function getStorage(): StorageProvider {
  if (provider) return provider;
  const env = getEnv();
  switch (env.STORAGE_PROVIDER) {
    case "local":
      provider = new LocalStorageProvider(env.UPLOADS_DIR);
      return provider;
    case "vercel-blob":
      provider = new VercelBlobStorageProvider(env.BLOB_READ_WRITE_TOKEN!);
      return provider;
  }
}

/** Tests: replace the storage provider. Pass undefined to reset. */
export function setStorage(p: StorageProvider | undefined): void {
  provider = p;
}
