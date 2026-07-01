import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// NativeWind v4 on web: the babel plugin rewrites className on RN primitives
// into the css-interop runtime; tailwind (via postcss) compiles the classes.
export default defineConfig({
  plugins: [
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
});
