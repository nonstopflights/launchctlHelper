import { NextResponse } from "next/server";
import { getDoctorReport } from "@/server/launchctl";

export async function GET() {
  try {
    const report = await getDoctorReport();
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load doctor report." },
      { status: 500 },
    );
  }
}
