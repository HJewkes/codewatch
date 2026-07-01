import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// react-native-css-interop's dev-only `doctor` ships JSX inside a .js file
// (`verifyJSX() { return <…-pragma-check /> }`), which breaks a cold Rollup
// build ("JSX syntax extension is not currently enabled"). It's a dev warning
// aid, unused in production — stub it with no-op verifiers.
function stubCssInteropDoctor(): Plugin {
  return {
    name: 'stub-css-interop-doctor',
    enforce: 'pre',
    load(id) {
      if (/react-native-css-interop[\\/]dist[\\/]doctor(\.native)?\.js$/.test(id)) {
        return 'module.exports = { verifyJSX: () => true, verifyFlag: () => true, verifyData: () => true };';
      }
      return null;
    },
  };
}

// NativeWind v4 on web: the babel plugin rewrites className on RN primitives
// into the css-interop runtime; tailwind (via postcss) compiles the classes.
export default defineConfig({
  plugins: [
    stubCssInteropDoctor(),
    react({
      babel: { presets: ['nativewind/babel'] },
    }),
    viteSingleFile(),
  ],
  resolve: {
    alias: { 'react-native': 'react-native-web' },
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.web.js', '.js'],
  },
  define: {
    // react-native-web / some RN libs reference these
    'process.env.NODE_ENV': JSON.stringify('production'),
    global: 'globalThis',
  },
  optimizeDeps: {
    // Some RN deps (e.g. react-native-css-interop) ship JSX in .js files;
    // pre-bundle them through esbuild with the jsx loader so Rollup then
    // consumes clean ESM. Without this a cold build fails on "JSX syntax
    // extension is not currently enabled".
    include: ['react-native-css-interop', 'nativewind', '@titan-design/react-ui'],
    esbuildOptions: { loader: { '.js': 'jsx' } },
  },
});
