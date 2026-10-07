import { serverApi } from "../../../lib/server-api";

export const dynamic = "force-dynamic";
export async function GET() { return serverApi.getState(); }
export async function PUT(request: Request) { return serverApi.putState(request); }
