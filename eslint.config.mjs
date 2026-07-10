import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      // These React Compiler checks were introduced by the Next 16 config.
      // Keep the established lint policy until the affected UI flows are refactored.
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "out/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
