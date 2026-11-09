import type { Config } from "tailwindcss";
import preset from "@hirevine/config/tailwind-preset";

export default {
  presets: [preset],
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
} satisfies Config;
