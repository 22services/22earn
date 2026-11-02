/** An error whose message is safe and useful to show to the user. */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppError";
  }
}

export type ActionState = { ok?: boolean; error?: string; message?: string; data?: Record<string, string> } | undefined;

/** Wrap a server action body: AppErrors become form errors, anything else is logged. */
export async function runAction(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (err) {
    // Next.js uses thrown errors for redirect()/notFound() — let them through.
    if (isNextControlFlow(err)) throw err;
    if (err instanceof AppError) return { error: err.message };
    console.error("[action]", err);
    return { error: "Something went wrong. Please try again." };
  }
}

export function isNextControlFlow(err: unknown) {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND");
}
