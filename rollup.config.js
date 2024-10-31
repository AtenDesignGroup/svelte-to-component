import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

const typescriptOptions = {
  exclude: ["tests/**/*"],
  compilerOptions: { declaration: false },
};

const config = [
  {
    external: [/node_modules/],
    input: "src/main.ts",
    output: {
      file: "dist/esm/index.js",
      format: "esm",
    },
    plugins: [
      nodeResolve(),
      commonjs(),
      typescript(typescriptOptions)
    ],
  },
  {
    external: [/node_modules/],
    input: "src/main.ts",
    output: {
      file: "dist/cjs/index.js",
      format: "cjs",
    },
    plugins: [
      nodeResolve(),
      commonjs(),
      typescript(typescriptOptions)
    ],
  },
];

export default config;
