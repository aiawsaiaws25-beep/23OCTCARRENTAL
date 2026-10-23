// Provider-neutral file storage. Files are private: the app serves them
// through its own authorised routes, never from a public folder or URL.

export type StoredFile = { key: string; size: number; contentType: string };

export interface StorageProvider {
  readonly name: string;
  put(key: string, data: Buffer | Uint8Array, contentType: string): Promise<StoredFile>;
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
