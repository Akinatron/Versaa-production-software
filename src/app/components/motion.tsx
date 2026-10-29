"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Where the active step or tab sat on the previous page, per set of links. */
const lastPlace = new Map<string, { left: number; width: number }>();

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Steps and tabs: the active bar or pill slides from where it was, so you see where you moved to. */
function slideIndicators() {
  document.querySelectorAll<HTMLElement>("nav.steps, nav.tabs").forEach((nav) => {
    const links = [...nav.querySelectorAll<HTMLAnchorElement>("a")];
    const active = links.find((a) => a.getAttribute("aria-current") === "page" || a.classList.contains("on"));
    if (!active) return;
    const key = `${nav.className}|${links.map((a) => a.getAttribute("href")).join(" ")}`;
    const navBox = nav.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    const now = { left: box.left - navBox.left + nav.scrollLeft, width: box.width };
    const before = lastPlace.get(key);
    lastPlace.set(key, now);
    if (!before || reduced() || (before.left === now.left && before.width === now.width)) return;
    const pseudoElement = nav.classList.contains("steps") ? "::after" : "::before";
    active.animate([{ transform: `translateX(${before.left - now.left}px) scaleX(${before.width / now.width})` }, { transform: "none" }], {
      duration: 280,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      pseudoElement,
    });
  });
}

/**
 * Small motion helpers that need the page: sliding step/tab indicators and a spinner on the
 * button that sent a form until the server answers. Everything else is plain CSS in globals.css.
 */
export function Motion() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    slideIndicators();
    document.querySelectorAll(".is-pending").forEach((b) => {
      b.classList.remove("is-pending");
      b.removeAttribute("aria-busy");
    });
  }, [pathname, search]);

  useEffect(() => {
    let pending: HTMLElement[] = [];
    let timer = 0;
    const clear = () => {
      pending.forEach((b) => {
        b.classList.remove("is-pending");
        b.removeAttribute("aria-busy");
      });
      pending = [];
      window.clearTimeout(timer);
    };
    // The server's answer re-renders the page: any change to it means the wait is over.
    const observer = new MutationObserver(() => pending.length && clear());
    const main = document.querySelector("main");
    if (main) observer.observe(main, { childList: true, subtree: true, characterData: true });

    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      const button = e.submitter as HTMLElement | null;
      // Forms that run a server action carry React's hidden $ACTION_ fields; other prevented submits are handled in the page.
      const serverAction =
        form.hasAttribute("data-keeps-input") ||
        !!form.querySelector('input[name^="$ACTION_"]') ||
        (button?.getAttribute("formaction") ?? form.getAttribute("action") ?? "").startsWith("javascript:");
      if (!button || (e.defaultPrevented && !serverAction) || form.target === "_blank") return;
      // A frame later, so the form data (including the button's own name/value) has been read.
      requestAnimationFrame(() => {
        button.classList.add("is-pending");
        button.setAttribute("aria-busy", "true");
        pending.push(button);
        window.clearTimeout(timer);
        // Downloads and the like never change the page: give the button back anyway.
        timer = window.setTimeout(clear, 10000);
      });
    };
    document.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener("submit", onSubmit);
      observer.disconnect();
      clear();
    };
  }, []);

  return null;
}
