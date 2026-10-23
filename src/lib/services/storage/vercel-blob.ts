import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";
import type { StorageProvider, StoredFile } from "./types";

/**
 * Vercel Blob storage with PRIVATE access (selected by STORAGE_PROVIDER=vercel-blob,
 * needs BLOB_READ_WRITE_TOKEN). Blobs are never exposed by URL: the app reads them
 * server-side and streams them through its authorised /api/files route.
 *
 * NOT live-tested yet: no Vercel Blob store is connected to this project.
 */
export class VercelBlobStorageProvider implements StorageProvider {
  readonly name = "vercel-blob";

  constructor(private readonly token: string) {}

  async put(key: string, data: Buffer | Uint8Array, contentType: string): Promise<StoredFile> {
    assertKey(key);
    await put(key, Buffer.from(data), {
      access: "private",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      token: this.token,
    });
    return { key, size: data.byteLength, contentType };
  }

  async get(key: string) {
    assertKey(key);
    const res = await get(key, { access: "private", token: this.token, useCache: false });
    if (!res || res.statusCode !== 200) return null;
    const data = Buffer.from(await new Response(res.stream).arrayBuffer());
    return { data, contentType: res.blob.contentType };
  }

  async delete(key: string) {
    assertKey(key);
    await del(key, { token: this.token });
  }

  async exists(key: string) {
    assertKey(key);
    try {
      await head(key, { token: this.token });
      return true;
    } catch (err) {
      if (err instanceof BlobNotFoundError) return false;
      throw err;
    }
  }
}

function assertKey(key: string) {
  if (!key || key.startsWith("/") || key.split("/").some((p) => p === ".." || p === ".")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}
