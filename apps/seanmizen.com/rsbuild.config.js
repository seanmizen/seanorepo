import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginGlsl } from "rsbuild-plugin-glsl";

export default defineConfig({
  plugins: [pluginReact(), pluginGlsl()],
  html: {
    template: "./public/index.html",
  },
  output: {
    assetPrefix: "/",
  },
});
