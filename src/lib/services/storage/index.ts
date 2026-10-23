import { getEnv } from "@/lib/env";
import { LocalStorageProvider } from "./local";
import type { StorageProvider } from "./types";

export * from "./types";

let provider: StorageProvider | undefined;

// Chosen by STORAGE_PROVIDER. Add the cloud provider (e.g. S3/R2) here later.
export function getStorage(): StorageProvider {
  if (provider) return provider;
  const env = getEnv();
  switch (env.STORAGE_PROVIDER) {
    case "local":
      provider = new LocalStorageProvider(env.UPLOADS_DIR);
      return provider;
    case "s3":
      throw new Error("STORAGE_PROVIDER=s3 is not implemented yet");
  }
}
