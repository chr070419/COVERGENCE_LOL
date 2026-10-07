import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../app/chatgpt-auth";
import { createBackend } from "./server-core.mjs";

export const serverApi = createBackend({
  getEnvironment: () => {
    const bindings = env as unknown as { DB?: D1Database; OWNER_EMAIL?: string };
    return { db: bindings.DB, ownerEmail: bindings.OWNER_EMAIL };
  },
  getUser: getChatGPTUser,
});
