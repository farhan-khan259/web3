import { NextRequest, NextResponse } from "next/server";
import { getBackendBaseUrl } from "../../../../lib/contracts";

export async function GET(_: NextRequest, { params }: { params: { tokenId: string } }) {
  try {
    const response = await fetch(`${getBackendBaseUrl()}/risk/${params.tokenId}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
