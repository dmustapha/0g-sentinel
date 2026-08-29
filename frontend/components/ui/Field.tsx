"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: ReactNode;
  hint?: ReactNode;
  invalid?: boolean;
  label: ReactNode;
  mono?: boolean;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { "aria-describedby": describedBy, "aria-invalid": nativeInvalid, className = "", error,
    hint, id, invalid = false, label, mono = false, ...props }, ref,
) {
  const generatedId = `ui-field-${useId().replaceAll(":", "")}`;
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const descriptions = [describedBy, hintId, errorId].filter(Boolean).join(" ") || undefined;
  const isInvalid = Boolean(error || invalid || (nativeInvalid && nativeInvalid !== "false"));

  return (
    <div className="ui-field" data-invalid={isInvalid ? "true" : undefined}>
      <label className="ui-field__label" htmlFor={inputId}>{label}</label>
      <input {...props} ref={ref} id={inputId}
        className={`ui-field__input${mono ? " ui-field__input--mono" : ""} ${className}`.trim()}
        aria-describedby={descriptions} aria-invalid={isInvalid || undefined} />
      {hint ? <span className="ui-field__hint" id={hintId}>{hint}</span> : null}
      {error ? <span className="ui-field__error" id={errorId}>{error}</span> : null}
    </div>
  );
});
