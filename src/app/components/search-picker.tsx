"use client";

/*
 * A search box that picks one record and puts its id in a hidden field.
 * Typing filters the list; the first match is highlighted, so Enter picks it
 * (arrow keys move, Escape closes). When nothing matches what was typed, the
 * last option creates it: `renderCreate` shows the small form for that and
 * calls `onCreated` with the new record, which is then picked.
 */
import { useId, useMemo, useRef, useState } from "react";

export interface PickOption {
  id: string;
  label: string;
  /** Shown after the label in muted text, e.g. the unit. */
  hint?: string;
  /** Group heading, e.g. "Ingredients". */
  group?: string;
}

export function SearchPicker({
  name,
  label,
  options: initial,
  placeholder,
  createLabel,
  renderCreate,
}: {
  name: string;
  label: string;
  options: PickOption[];
  placeholder?: string;
  /** Text of the "create" option, e.g. (t) => `Create ingredient "${t}"`. */
  createLabel: (text: string) => string;
  renderCreate: (text: string, done: (created: PickOption | null) => void) => React.ReactNode;
}) {
  const [options, setOptions] = useState(initial);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<PickOption | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return options;
    const starts = options.filter((o) => o.label.toLowerCase().startsWith(q));
    const contains = options.filter((o) => !o.label.toLowerCase().startsWith(q) && o.label.toLowerCase().includes(q));
    return [...starts, ...contains];
  }, [options, text]);
  const exact = matches.some((o) => o.label.toLowerCase() === text.trim().toLowerCase());
  const canCreate = text.trim().length > 0 && !exact;
  // The "create" choice is the last row.
  const rows = matches.length + (canCreate ? 1 : 0);

  function pick(i: number) {
    if (i < matches.length) {
      setPicked(matches[i]!);
      setOpen(false);
      setText("");
    } else if (canCreate) {
      setCreating(text.trim());
      setOpen(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, rows - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      // Enter picks; it never sends the form from the search box.
      e.preventDefault();
      if (rows > 0) pick(Math.min(active, rows - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  let lastGroup: string | undefined;
  return (
    <div className="picker">
      <label htmlFor={`${listId}-input`}>{label}</label>
      <input type="hidden" name={name} value={picked?.id ?? ""} />
      {picked ? (
        <div className="picker-picked">
          <span>
            <strong>{picked.label}</strong>
            {picked.hint && <span className="muted"> ({picked.hint})</span>}
          </span>
          <button
            type="button"
            className="ghost sm"
            onClick={() => {
              setPicked(null);
              setTimeout(() => input.current?.focus(), 0);
            }}
          >
            Change
          </button>
        </div>
      ) : (
        <div className="picker-box">
          <input
            ref={input}
            id={`${listId}-input`}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && rows > 0 ? `${listId}-${Math.min(active, rows - 1)}` : undefined}
            autoComplete="off"
            placeholder={placeholder}
            value={text}
            disabled={creating !== null}
            onChange={(e) => {
              setText(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={onKey}
          />
          {open && rows > 0 && (
            <ul className="picker-list" id={listId} role="listbox">
              {matches.map((o, i) => {
                const head = o.group && o.group !== lastGroup ? o.group : null;
                lastGroup = o.group;
                return (
                  <li key={o.id} role="presentation">
                    {head && <div className="picker-group">{head}</div>}
                    <div
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === active}
                      className="picker-option"
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(i)}
                    >
                      {o.label}
                      {o.hint && <span className="muted"> ({o.hint})</span>}
                    </div>
                  </li>
                );
              })}
              {canCreate && (
                <li role="presentation">
                  <div
                    id={`${listId}-${matches.length}`}
                    role="option"
                    aria-selected={active === matches.length}
                    className="picker-option picker-create"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(matches.length)}
                    onClick={() => pick(matches.length)}
                  >
                    + {createLabel(text.trim())}
                  </div>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
      {creating !== null &&
        renderCreate(creating, (created) => {
          setCreating(null);
          if (created) {
            setOptions((o) => [...o, created]);
            setPicked(created);
            setText("");
          } else {
            setTimeout(() => input.current?.focus(), 0);
          }
        })}
    </div>
  );
}
