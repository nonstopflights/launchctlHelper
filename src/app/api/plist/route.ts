import { NextResponse } from "next/server";
import { getPlistDocument, savePlistDocument } from "@/server/launchctl";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const servicePath = searchParams.get("path");
    if (!servicePath) {
      return NextResponse.json({ error: "Missing plist path." }, { status: 400 });
    }

    const document = await getPlistDocument(servicePath);
    return NextResponse.json(document);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load plist." },
      { status: 400 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const payload = await request.json();
    const result = await savePlistDocument(payload);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save plist." },
      { status: 400 },
    );
  }
}
