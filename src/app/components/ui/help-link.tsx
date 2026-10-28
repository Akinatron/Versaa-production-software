"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { helpSlugFor } from "@/help/screens";
import { Icon } from "./icons";

/** The "?" on every page header: opens the help guide for the screen you are on. */
export function HelpLink() {
  const slug = helpSlugFor(usePathname() ?? "/");
  if (!slug) return null;
  return (
    <Link href={`/help/${slug}`} className="help-link" aria-label="Help for this screen" title="Help for this screen">
      <Icon name="help" className="" size={18} />
    </Link>
  );
}
