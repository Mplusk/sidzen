"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";

/** Keep submitter name/value intact: several integration forms use multiple intents. */
export function SubmitButton({ children, pendingLabel = "Сохраняем…", disabled, className = "button", ...props }: ComponentProps<"button"> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return <button {...props} type="submit" className={className} disabled={disabled || pending} aria-busy={pending} aria-live="polite">{pending ? pendingLabel : children}</button>;
}
