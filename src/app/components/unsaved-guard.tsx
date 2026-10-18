"use client";

import { useEffect, useRef, useState, type FormHTMLAttributes } from "react";

const MESSAGE = "You have changes that aren't saved yet. Leave this page and lose them?";

/**
 * Warn before leaving the page while `dirty`: closing or reloading the tab
 * (browser prompt) and clicking a link inside the app (confirm dialog).
 */
export function useUnsavedWarning(dirty: boolean) {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    // Capture phase on the document runs before the app's own link handling.
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const to = new URL(a.href, window.location.href);
      if (to.pathname === window.location.pathname && to.search === window.location.search) return;
      if (!window.confirm(MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
}

/** A form that warns before leaving the page once something in it was typed and not saved. */
export function GuardedForm({ children, onInput, onSubmit, ...rest }: FormHTMLAttributes<HTMLFormElement>) {
  const [dirty, setDirty] = useState(false);
  useUnsavedWarning(dirty);
  return (
    <form
      {...rest}
      onInput={(e) => {
        setDirty(true);
        onInput?.(e);
      }}
      onSubmit={(e) => {
        setDirty(false);
        onSubmit?.(e);
      }}
    >
      {children}
    </form>
  );
}

/** A submit button that asks first. */
export function ConfirmButton({ message, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { message: string }) {
  return (
    <button
      type="submit"
      {...rest}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
