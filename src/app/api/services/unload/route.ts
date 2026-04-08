import { NextResponse } from "next/server";
import { unloadService } from "@/server/launchctl";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = await unloadService(payload);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unload failed." },
      { status: 400 },
    );
  }
}
