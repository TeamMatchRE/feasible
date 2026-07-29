"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps, ReactNode } from "react";

/**
 * Submit button that says so while its form's server action is in flight.
 * Without it the button looks untouched while the action runs, which reads as
 * "nothing happened" and invites a second click. Must be rendered inside the
 * <form> it belongs to; useFormStatus reads that form's state.
 */
export function SubmitButton({
  children,
  pendingLabel = "Working…",
  className,
  disabled,
  formAction,
  formNoValidate,
  title,
  name,
  value,
  style,
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  formAction?: ComponentProps<"button">["formAction"];
  formNoValidate?: boolean;
  title?: string;
  name?: string;
  value?: string;
  style?: React.CSSProperties;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      formAction={formAction}
      formNoValidate={formNoValidate}
      name={name}
      value={value}
      disabled={pending || disabled}
      aria-busy={pending}
      title={title}
      style={style}
      className={className}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
