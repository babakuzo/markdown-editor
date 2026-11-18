import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import '@stylexswc/webpack-plugin/stylex.css';
import './globals.css';
import {Providers} from './providers';

export const metadata: Metadata = {
  title: 'Notr',
  description: 'Open, read and edit Markdown files without knowing Markdown.',
  other: {'notr-build': '05SA-EVI7-GUXA-GG52'},
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
