/**
 * Umami analytics — drop into your root layout to enable tracking.
 *
 * Pattern: load via Next's <Script> with strategy="afterInteractive" so
 * it doesn't block hydration. Falls through silently in dev (no DSN).
 *
 * Usage:
 *   // app/layout.tsx
 *   import { UmamiAnalytics } from '@/components/UmamiAnalytics';
 *   ...
 *   <body>
 *     {children}
 *     <UmamiAnalytics />
 *   </body>
 */
import Script from 'next/script';

export function UmamiAnalytics() {
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  // Self-host? Override the host. Default = cloud.umami.is.
  const src =
    process.env.NEXT_PUBLIC_UMAMI_SRC ?? 'https://cloud.umami.is/script.js';

  if (!websiteId || process.env.NODE_ENV !== 'production') return null;

  return (
    <Script
      src={src}
      data-website-id={websiteId}
      strategy="afterInteractive"
      defer
    />
  );
}
