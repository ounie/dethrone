import next from "eslint-config-next";

/**
 * eslint-config-next 16 ships a flat config array directly. The FlatCompat
 * shim is for configs that have not migrated yet, and wrapping an
 * already-flat config in it produces a circular-structure crash rather than a
 * useful error — so spread it and move on.
 */
const config = [
  ...next,
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
];

export default config;
