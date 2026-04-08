import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const external = [/^node:/];

export default {
  input: "src/plugin.ts",
  output: {
    file: "com.aelchert.apple-music-album.sdPlugin/bin/plugin.js",
    format: "esm",
    sourcemap: true
  },
  external,
  plugins: [
    resolve({
      preferBuiltins: true
    }),
    commonjs(),
    typescript({
      tsconfig: "./tsconfig.json"
    })
  ]
};
