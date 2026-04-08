import { NextResponse } from "next/server";
import { getServices } from "@/server/launchctl";

export async function GET() {
  try {
    const services = await getServices();
    return NextResponse.json({ services });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load services." },
      { status: 500 },
    );
  }
}
