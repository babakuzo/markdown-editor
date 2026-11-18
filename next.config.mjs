import stylexPlugin from '@stylexswc/nextjs-plugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {unoptimized: true},
  // Relative asset paths so the export runs from any folder: a WKWebView
  // file:// bundle in the Mac app, or a hosted artifact.
  assetPrefix: './',
};

// StyleX compiles our own source only (two of the Astryx page templates use it).
// Astryx itself ships prebuilt CSS and is never compiled here.
export default stylexPlugin({
  rsOptions: {dev: process.env.NODE_ENV === 'development'},
})(nextConfig);
