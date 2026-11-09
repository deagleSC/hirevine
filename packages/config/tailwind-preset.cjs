/** Shared design tokens. Colors are CSS variables defined in @hirevine/ui/styles.css. */
const v = (name) => `hsl(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        border: v("border"),
        input: v("input"),
        ring: v("ring"),
        background: v("background"),
        foreground: v("foreground"),
        primary: { DEFAULT: v("primary"), foreground: v("primary-foreground") },
        secondary: { DEFAULT: v("secondary"), foreground: v("secondary-foreground") },
        muted: { DEFAULT: v("muted"), foreground: v("muted-foreground") },
        accent: { DEFAULT: v("accent"), foreground: v("accent-foreground") },
        destructive: { DEFAULT: v("destructive"), foreground: v("destructive-foreground") },
        warning: { DEFAULT: v("warning"), foreground: v("warning-foreground") },
        success: { DEFAULT: v("success"), foreground: v("success-foreground") },
        card: { DEFAULT: v("card"), foreground: v("card-foreground") },
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
      fontFamily: { sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
