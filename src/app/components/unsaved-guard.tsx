"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useTransition, type FormHTMLAttributes, type ReactNode } from "react";

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

/** What a form's server action hands back: nothing when it went to another page, or the problem to show. */
export type FormResult = { error: string } | undefined | void;

/**
 * A form that warns before leaving the page once something in it was typed
 * and not saved. When saving fails (the action returns `{ error }`), the
 * message shows at the top of the form and everything typed stays, files
 * picked included. On success the action redirects as usual.
 */
export function GuardedForm({
  children,
  onInput,
  onSubmit,
  action,
  ...rest
}: Omit<FormHTMLAttributes<HTMLFormElement>, "action"> & { action: (form: FormData) => Promise<FormResult> }) {
  const [dirty, setDirty] = useState(false);
  const group = useContext(UnsavedContext);
  useEffect(() => group?.setDirty(dirty), [group, dirty]);
  const [problem, setProblem] = useState<{ text: string; n: number } | null>(null);
  const [saving, startSaving] = useTransition();
  const problemRef = useRef<HTMLUListElement>(null);
  useUnsavedWarning(dirty && !saving);
  useEffect(() => {
    problemRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [problem]);
  return (
    <form
      {...rest}
      data-keeps-input=""
      onInput={(e) => {
        setDirty(true);
        onInput?.(e);
      }}
      onSubmit={(e) => {
        onSubmit?.(e);
        if (e.defaultPrevented) return;
        // Sent by hand (not as a form action) so React doesn't clear the fields afterwards.
        e.preventDefault();
        if (saving) return;
        const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startSaving(async () => {
          const result = await action(data);
          if (result?.error) setProblem((p) => ({ text: result.error, n: (p?.n ?? 0) + 1 }));
        });
      }}
    >
      {problem && (
        // A new key each time, so the same message shown twice still re-renders (and the button's spinner stops).
        <ul key={problem.n} ref={problemRef} className="issues" role="alert">
          <li className="bad">{problem.text}</li>
        </ul>
      )}
      {children}
    </form>
  );
}

const UnsavedContext = createContext<{ dirty: boolean; setDirty: (dirty: boolean) => void } | null>(null);

/** Lets `WhenSaved` know when a GuardedForm inside it has unsaved changes. */
export function UnsavedGroup({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(false);
  const value = useMemo(() => ({ dirty, setDirty }), [dirty]);
  return <UnsavedContext.Provider value={value}>{children}</UnsavedContext.Provider>;
}

/**
 * Things that use what is saved (a message built from it, "Mark as sent"):
 * blocked, with `note` above them, while a form in the same UnsavedGroup has
 * unsaved changes.
 */
export function WhenSaved({ note, children }: { note: string; children: ReactNode }) {
  const blocked = useContext(UnsavedContext)?.dirty ?? false;
  return (
    <>
      {blocked && (
        <ul className="issues" role="status" style={{ marginTop: 16 }}>
          <li className="warn">{note}</li>
        </ul>
      )}
      <div inert={blocked} aria-disabled={blocked || undefined} style={blocked ? { opacity: 0.45 } : undefined}>
        {children}
      </div>
    </>
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
