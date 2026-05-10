import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '{{project.name}}',
  description: '{{project.description}}',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
