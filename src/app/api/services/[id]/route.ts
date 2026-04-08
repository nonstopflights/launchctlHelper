import { NextResponse } from "next/server";
import { getServiceDetail } from "@/server/launchctl";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const detail = await getServiceDetail(id);
    if (!detail) {
      return NextResponse.json({ error: "Service not found." }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load service detail." },
      { status: 500 },
    );
  }
}
