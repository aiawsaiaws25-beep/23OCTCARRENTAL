import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { StorageProvider, StoredFile } from "./types";

// Stores uploads in a private folder on disk (UPLOADS_DIR, default ./uploads).
// A ".meta.json" sidecar keeps the content type next to each file.
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
    const publicDir = resolve("public");
    if (this.root === publicDir || this.root.startsWith(publicDir + sep)) {
      throw new Error("UPLOADS_DIR must not be inside the public folder");
    }
  }

  async put(key: string, data: Buffer | Uint8Array, contentType: string): Promise<StoredFile> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    await writeFile(`${path}.meta.json`, JSON.stringify({ contentType }));
    return { key, size: data.byteLength, contentType };
  }

  async get(key: string) {
    const path = this.pathFor(key);
    try {
      const [data, meta] = await Promise.all([readFile(path), readFile(`${path}.meta.json`, "utf8")]);
      return { data, contentType: (JSON.parse(meta) as { contentType: string }).contentType };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string) {
    const path = this.pathFor(key);
    await rm(path, { force: true });
    await rm(`${path}.meta.json`, { force: true });
  }

  async exists(key: string) {
    return stat(this.pathFor(key)).then(
      () => true,
      () => false,
    );
  }

  // Rejects keys like "../../etc/passwd" that would escape the uploads folder.
  private pathFor(key: string): string {
    const path = resolve(join(this.root, key));
    const rel = relative(this.root, path);
    if (!rel || rel.startsWith("..") || resolve(rel) === rel || key.endsWith(".meta.json")) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return path;
  }
}
