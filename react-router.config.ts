import { vercelPreset } from "@vercel/react-router/vite";
import type { Config } from "@react-router/dev/config";

export default {
  presets: [vercelPreset()],
  routeDiscovery: { mode: "initial" },
  allowedActionOrigins: ["naia-test-store.myshopify.com"],
  future: { v8_middleware: true },
} satisfies Config;
