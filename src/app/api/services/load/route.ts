import { NextResponse } from "next/server";
import { loadService } from "@/server/launchctl";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = await loadService(payload);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Load failed." },
      { status: 400 },
    );
  }
}
