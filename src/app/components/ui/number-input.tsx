import type { ComponentProps } from "react";

/**
 * A box for typing a number. It is a text box on purpose: a browser number
 * field drops a comma when Windows is in English ("12,5" becomes 125), and
 * the app accepts "7,5" and "7.5" alike (src/domain/typed-number.ts). The
 * server checks the value and says what's wrong, so there is no min/max/step.
 * `whole` for jars, packs, ml and days: the keyboard on a phone shows digits.
 */
export function NumberInput({
  whole,
  className,
  ...rest
}: Omit<ComponentProps<"input">, "type" | "inputMode" | "min" | "max" | "step"> & { whole?: boolean }) {
  return (
    <input
      type="text"
      inputMode={whole ? "numeric" : "decimal"}
      autoComplete="off"
      spellCheck={false}
      className={className ? `num-input ${className}` : "num-input"}
      {...rest}
    />
  );
}
