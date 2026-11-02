"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/errors";
import { CopyButton } from "./copy-button";
import { buttonClass, cn, type ButtonSize, type ButtonVariant } from "./ui";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * A form bound to a server action with inline error / success feedback.
 * Server actions return { error } or { ok, message } (see lib/errors.ts › runAction).
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  showMessage = true,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  showMessage?: boolean;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      <FormFeedback state={state} show={showMessage} />
    </form>
  );
}

export function FormFeedback({ state, show = true }: { state: ActionState; show?: boolean }) {
  if (!state || !show) return null;
  if (state.error)
    return (
      <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
        {state.error}
      </p>
    );
  if (state.message)
    return (
      <div role="status" className={cn("mt-3 rounded-xl px-3 py-2 text-sm", state.ok === false ? "bg-warning/10 text-warning" : "bg-success/10 text-success")}>
        <p>{state.message}</p>
        {state.data?.link ? (
          <div className="mt-2 flex items-center gap-2">
            <input readOnly value={state.data.link} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-fg" />
            <CopyButton value={state.data.link} label="Copy" />
          </div>
        ) : null}
        {state.data?.details ? <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-muted">{state.data.details}</pre> : null}
      </div>
    );
  return null;
}

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  className,
  confirm,
  name,
  value,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  confirm?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={buttonClass(variant, size, className)}
    >
      {pending ? (
        <>
          <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
          {pendingText ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Hidden input with the browser's timezone (used on sign-up / settings). */
export function TimezoneInput({ name = "timezone" }: { name?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }, []);
  return <input ref={ref} type="hidden" name={name} defaultValue="UTC" />;
}

export function InlineError({ message, className }: { message?: string; className?: string }) {
  if (!message) return null;
  return <p className={cn("text-sm text-danger", className)}>{message}</p>;
}
