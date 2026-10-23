import type { NextRequest } from "next/server";
import { getAuthorizedFile } from "@/server/uploads";
import { getCurrentUser } from "@/server/session";

// Private uploads (driving licences, damage photos). Served only to the owner or an
// admin; everyone else (including signed-out visitors) gets the same 404.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/files/[...key]">) {
  const { key } = await ctx.params;
  const user = await getCurrentUser(request.headers);
  const file = await getAuthorizedFile(user, key.map(decodeURIComponent).join("/"));
  if (!file) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "content-type": file.contentType,
      "content-length": String(file.data.byteLength),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
