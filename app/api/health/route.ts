import { NextResponse } from "next/server";

const startedAt = Date.now();

export async function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  });
}
