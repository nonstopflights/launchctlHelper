import { NextResponse } from "next/server";
import { setServiceEnabled } from "@/server/launchctl";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = await setServiceEnabled("disable", payload);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Disable failed." },
      { status: 400 },
    );
  }
}
