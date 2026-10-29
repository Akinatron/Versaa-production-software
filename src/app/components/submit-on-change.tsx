"use client";

import type { InputHTMLAttributes } from "react";

/** An input that sends its (GET) form as soon as its value changes, e.g. a date that reloads the figures. */
export function SubmitOnChange(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} onChange={(e) => e.currentTarget.value && e.currentTarget.form?.requestSubmit()} />;
}
