"use client";

import { useId, useState, type ComponentProps } from "react";

/** Native constraints remain authoritative; explain errors beside the field on blur. */
export function ValidatedInput({ onBlur, onInput, onInvalid, "aria-describedby": describedBy, ...props }: ComponentProps<"input">) {
  const errorId = useId();
  const [error, setError] = useState("");
  const validate = (input: HTMLInputElement) => {
    const validity = input.validity;
    const message = validity.valid ? "" : validity.valueMissing ? "Заполните это поле." : validity.typeMismatch && input.type === "email" ? "Введите email в формате name@example.ru." : validity.patternMismatch && input.type === "tel" ? "Введите номер полностью: +7 (999) 123-45-67." : validity.tooShort ? `Не менее ${input.minLength} символов.` : input.validationMessage;
    setError(message);
  };
  return <>
    <input {...props} aria-invalid={error ? true : undefined} aria-describedby={[describedBy, error ? errorId : undefined].filter(Boolean).join(" ") || undefined}
      onBlur={event => { validate(event.currentTarget); onBlur?.(event); }}
      onInput={event => { if (error) validate(event.currentTarget); onInput?.(event); }}
      onInvalid={event => { validate(event.currentTarget); onInvalid?.(event); }} />
    {error && <small id={errorId} className="field-error" role="status">{error}</small>}
  </>;
}
