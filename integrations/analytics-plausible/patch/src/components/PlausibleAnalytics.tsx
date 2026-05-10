/**
 * Plausible Analytics — drop into your root layout to enable tracking.
 *
 *   // app/layout.tsx
 *   import { PlausibleAnalytics } from '@/components/PlausibleAnalytics';
 *   ...
 *   <body>
 *     {children}
 *     <PlausibleAnalytics />
 *   </body>
 *
 * Self-hosted? Set NEXT_PUBLIC_PLAUSIBLE_SRC to your instance URL.
 */
import Script from 'next/script';

export function PlausibleAnalytics() {
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  // Default: Plausible Cloud. Override for self-hosted.
  const src =
    process.env.NEXT_PUBLIC_PLAUSIBLE_SRC ?? 'https://plausible.io/js/script.js';

  if (!domain || process.env.NODE_ENV !== 'production') return null;

  return <Script src={src} data-domain={domain} strategy="afterInteractive" defer />;
}
