import { serverApi } from "../../../lib/server-api";

export const dynamic = "force-dynamic";
export async function GET(request: Request) { return serverApi.getAudit(request); }
