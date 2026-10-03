"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action";
import { btnCls, btnDangerCls, btnPrimaryCls } from "./ui";

type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children?: ReactNode;
  submitLabel?: string;
  variant?: "primary" | "default" | "danger";
  className?: string;
  /** Ask the user before submitting. */
  confirm?: string;
  resetOnSuccess?: boolean;
  /** Render the button inline next to the fields. */
  inline?: boolean;
  /** A second submit button; its name/value are posted when it is used. */
  secondary?: { label: string; name: string; value: string };
};

export function SubmitButton({ label, variant = "primary", name, value }: { label: string; variant?: Props["variant"]; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  const cls = variant === "primary" ? btnPrimaryCls : variant === "danger" ? btnDangerCls : btnCls;
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={cls}>
      {pending ? "Saving…" : label}
    </button>
  );
}

export function ActionForm({ action, children, submitLabel = "Save", variant = "primary", className = "", confirm, resetOnSuccess, inline, secondary }: Props) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      action={formAction}
      className={inline ? `flex flex-wrap items-end gap-2 ${className}` : `space-y-3 ${className}`}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {state.error && (
        <p role="alert" className="w-full text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.links && state.links.length > 0 && (
        <ul className="w-full list-disc pl-5 text-sm">
          {state.links.map((l) => (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      {state.ok && state.message && <p className="w-full text-sm text-green-700">{state.message}</p>}
      <div className={inline ? "" : "flex flex-wrap gap-2 pt-1"}>
        {secondary && <SubmitButton label={secondary.label} variant="default" name={secondary.name} value={secondary.value} />}
        <SubmitButton label={submitLabel} variant={variant} />
      </div>
    </form>
  );
}
