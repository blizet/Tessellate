import { NextResponse } from "next/server";
import { getExport } from "@/lib/server/fileStore";

export const runtime = "nodejs";

type Params = { params: Promise<{ fileId: string }> };

export async function GET(req: Request, segment: Params) {
  const { fileId } = await segment.params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "glb";

  const bundle = getExport(fileId);
  if (!bundle) {
    return NextResponse.json(
      {
        success: false,
        error: "FILE_NOT_FOUND",
        message: "Requested file does not exist or has expired",
        statusCode: 404,
      },
      { status: 404 },
    );
  }

  if (format === "png") {
    return new NextResponse(new Uint8Array(bundle.png), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="tessellate-preview.png"`,
      },
    });
  }

  if (format === "json") {
    return NextResponse.json(bundle.meta, {
      headers: {
        "Content-Disposition": `attachment; filename="tessellate-metadata.json"`,
      },
    });
  }

  return new NextResponse(new Uint8Array(bundle.glb), {
    headers: {
      "Content-Type": "model/gltf-binary",
      "Content-Disposition": `attachment; filename="tessellate-mockup.glb"`,
    },
  });
}
