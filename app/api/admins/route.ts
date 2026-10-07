import { serverApi } from "../../../lib/server-api";

export const dynamic = "force-dynamic";
export async function GET() { return serverApi.getAdmins(); }
export async function POST(request: Request) { return serverApi.addAdmin(request); }
export async function DELETE(request: Request) { return serverApi.removeAdmin(request); }
