/* One drawn icon set: 24-unit grid, 1.75 stroke, round joins. */
const paths: Record<string, React.ReactNode> = {
  today: (
    <>
      <path d="M4 11.5 12 5l8 6.5" />
      <path d="M6 10v9h12v-9" />
      <path d="M10 19v-5h4v5" />
    </>
  ),
  plan: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4v2h6V4" />
      <path d="M8.5 11h7M8.5 15h4.5" />
    </>
  ),
  runs: (
    <>
      <path d="M12 3 3.5 7.5 12 12l8.5-4.5L12 3Z" />
      <path d="m3.5 12 8.5 4.5 8.5-4.5" />
      <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
    </>
  ),
  production: (
    <>
      <path d="M4 11h16v3a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6v-3Z" />
      <path d="M2.5 11h19" />
      <path d="M9 7.5c0-1.5 1-1.5 1-3M14 7.5c0-1.5 1-1.5 1-3" />
    </>
  ),
  packaging: (
    <>
      <path d="M8 3h8v3H8z" />
      <path d="M7 6h10l1 3v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9l1-3Z" />
      <path d="M6 12h12v5H6" />
    </>
  ),
  batches: (
    <>
      <rect x="3.5" y="4" width="17" height="5" rx="1.5" />
      <path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9" />
      <path d="M10 13h4" />
    </>
  ),
  orders: (
    <>
      <path d="M3 4h2.2l2 11.2a1.5 1.5 0 0 0 1.5 1.3h8.6a1.5 1.5 0 0 0 1.5-1.2L20.5 8H6" />
      <circle cx="9.5" cy="20" r="1" />
      <circle cx="17" cy="20" r="1" />
    </>
  ),
  deliveries: (
    <>
      <path d="M3 6h11v10H3z" />
      <path d="M14 9.5h3.5L21 13v3h-7" />
      <circle cx="7" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </>
  ),
  suppliers: (
    <>
      <path d="M3.5 20V9l5 3V9l5 3V6l7 3.5V20Z" />
      <path d="M7.5 16h1M12 16h1M16.5 16h1" />
    </>
  ),
  stock: (
    <>
      <path d="M4 4v16M20 4v16" />
      <path d="M4 9h16M4 15h16" />
      <rect x="7" y="10.5" width="4" height="4.5" rx="0.5" />
      <rect x="12.5" y="5" width="4" height="4" rx="0.5" />
    </>
  ),
  trace: (
    <>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="18" cy="18" r="2.2" />
      <path d="M8.2 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.8" />
    </>
  ),
  outbound: (
    <>
      <path d="M12 3v12" />
      <path d="m7.5 7.5 4.5-4.5 4.5 4.5" />
      <path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" />
    </>
  ),
  reports: (
    <>
      <path d="M4 20h16" />
      <path d="M7 16v-5M12 16V6M17 16v-8" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12M18 6 6 18" />
    </>
  ),
  back: (
    <>
      <path d="m14 6-6 6 6 6" />
    </>
  ),
  doc: (
    <>
      <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h4" />
    </>
  ),
  photo: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4 17 5-4.5 3.5 3 2.5-2 4.5 3.5" />
    </>
  ),
};

export type IconName = keyof typeof paths;

export function Icon({ name, className = "nav-icon", size = 18 }: { name: IconName | string; className?: string; size?: number }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/** The Versaa mark: a filled jar under its lid. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6.5" y="2.5" width="11" height="4" rx="1.2" fill="var(--brand)" />
      <path d="M6 8h12a1.5 1.5 0 0 1 1.5 1.5V19a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 19V9.5A1.5 1.5 0 0 1 6 8Z" fill="currentColor" opacity="0.92" />
      <path d="M4.5 13.5h15v4h-15z" fill="var(--brand)" opacity="0.85" />
    </svg>
  );
}
