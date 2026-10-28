"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark, Icon } from "./icons";

export interface NavCounts {
  production: number;
  packaging: number;
  draftOrders: number;
  onTheWay: number;
  salesToDeliver: number;
}

type Entry = {
  href: string;
  label: string;
  icon: string;
  count?: number;
  hot?: boolean;
  also?: string[];
};

/**
 * The app's one navigation: grouped by the job (make, buy, keep, sell), with
 * a count wherever work is waiting. Collapses to a drawer on small screens.
 */
export function Sidebar({ counts }: { counts: NavCounts }) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  const groups: { label?: string; entries: Entry[] }[] = [
    { entries: [{ href: "/", label: "Today", icon: "today" }] },
    {
      label: "Make",
      entries: [
        { href: "/runs", label: "Runs", icon: "runs", also: ["/plan"] },
        {
          href: "/batches",
          label: "Batches",
          icon: "batches",
          count: counts.production + counts.packaging,
          also: ["/production", "/packaging"],
        },
      ],
    },
    {
      label: "Buy",
      entries: [
        {
          href: "/orders",
          label: "Orders",
          icon: "orders",
          count: counts.draftOrders,
          hot: counts.draftOrders > 0,
        },
        {
          href: "/deliveries",
          label: "Deliveries",
          icon: "deliveries",
          count: counts.onTheWay,
        },
        {
          href: "/suppliers",
          label: "Suppliers",
          icon: "suppliers",
        },
      ],
    },
    {
      label: "Keep",
      entries: [
        { href: "/stock", label: "Stock", icon: "stock", also: ["/items"] },
        { href: "/trace", label: "Trace", icon: "trace" },
        { href: "/history", label: "History", icon: "history" },
      ],
    },
    {
      label: "Sell",
      entries: [
        {
          href: "/outbound",
          label: "Outbound",
          icon: "outbound",
          count: counts.salesToDeliver,
        },
        { href: "/reports", label: "Reports", icon: "reports" },
      ],
    },
  ];

  const isActive = (e: Entry) => (e.href === "/" ? path === "/" : [e.href, ...(e.also ?? [])].some((h) => path === h || path.startsWith(h + "/")));

  const link = (e: Entry) => (
    <Link key={e.href} href={e.href} className="nav" aria-current={isActive(e) ? "page" : undefined}>
      <Icon name={e.icon} />
      {e.label}
      {e.count ? <span className={`nav-count${e.hot ? " hot" : ""}`}>{e.count}</span> : null}
    </Link>
  );

  return (
    <>
      <div className="topbar">
        <button type="button" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <Icon name="menu" className="" size={22} />
        </button>
        <Link href="/" className="brand">
          <BrandMark size={20} />
          Versaa
        </Link>
      </div>
      <div className={`scrim${open ? " open" : ""}`} onClick={() => setOpen(false)} />
      <aside className={`side${open ? " open" : ""}`} aria-label="Main">
        <Link href="/" className="brand">
          <BrandMark />
          Versaa
        </Link>
        <nav>
          {groups.map((g, i) => (
            <div className="group" key={i}>
              {g.label && <div className="group-label">{g.label}</div>}
              {g.entries.map(link)}
            </div>
          ))}
        </nav>
        <div className="foot">
          {link({ href: "/help", label: "Help", icon: "help" })}
          {link({ href: "/settings", label: "Settings", icon: "settings" })}
        </div>
      </aside>
    </>
  );
}
