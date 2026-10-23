import "server-only";
import type { ActionState } from "@/components/action-form";
import type { Result } from "@/server/errors";

// FormData helpers for admin Server Actions. Services validate again with zod.

export function text(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function optText(fd: FormData, key: string): string | null {
  const v = text(fd, key);
  return v === "" ? null : v;
}

export function int(fd: FormData, key: string): number {
  const v = text(fd, key);
  return v === "" ? Number.NaN : Number(v);
}

export function optInt(fd: FormData, key: string): number | null {
  const v = text(fd, key);
  return v === "" ? null : Number(v);
}

export function bool(fd: FormData, key: string): boolean {
  return fd.get(key) === "on" || fd.get(key) === "true";
}

/** "123.45" AED -> 12345 fils without floating point drift. NaN when malformed. */
export function aedToFils(value: string): number {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) return Number.NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

export function filsField(fd: FormData, key: string): number {
  return aedToFils(text(fd, key));
}

export function optFilsField(fd: FormData, key: string): number | null {
  const v = text(fd, key);
  return v === "" ? null : aedToFils(v);
}

export function filsToAedInput(fils: number | null | undefined): string {
  if (fils == null) return "";
  return (fils / 100).toFixed(2);
}

/** Files from a multi-file input, ignoring the empty placeholder browsers send. */
export async function files(fd: FormData, key: string) {
  const list = fd.getAll(key).filter((f): f is File => f instanceof File && f.size > 0);
  return Promise.all(
    list.map(async (f) => ({ data: Buffer.from(await f.arrayBuffer()), contentType: f.type, filename: f.name })),
  );
}

export function toState(result: Result, success: string): ActionState {
  return result.ok ? { ok: true, message: success } : { ok: false, message: result.message };
}
