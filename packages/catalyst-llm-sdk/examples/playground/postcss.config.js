// PostCSS pipeline for the playground.
//
// `postcss-import` is needed because @thebranchdriftcatalyst/catalyst-ui's
// bundled CSS starts with `@import url("https://fonts...")` and we then
// import that file *after* `@import "tailwindcss"`. Without postcss-import
// hoisting the remote @import to the top of the resolved bundle, Vite/
// PostCSS's parser fails with "@import must precede all other statements".
// postcss-import inlines/hoists @imports during processing and the rest
// of the pipeline (Tailwind v4 via @tailwindcss/vite, autoprefixer if
// configured) sees a clean tree.
import postcssImport from "postcss-import";

export default {
  plugins: [postcssImport()],
};
