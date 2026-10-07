import { serverApi } from "../../../lib/server-api";

export const dynamic = "force-dynamic";
export async function GET() { return serverApi.session(); }
