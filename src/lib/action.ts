import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { ForbiddenError } from "./permissions";

export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Links shown under the message, e.g. duplicate-link matches. */
  links?: { href: string; label: string }[];
};

/** An error whose message is safe and useful to show the user. */
export class UserError extends Error {
  constructor(
    message: string,
    public links?: { href: string; label: string }[],
  ) {
    super(message);
    this.name = "UserError";
  }
}

export function errorToState(e: unknown): ActionState {
  if (e instanceof UserError) return { error: e.message, links: e.links };
  if (e instanceof ForbiddenError) return { error: "You don't have permission to do that." };
  if (e instanceof z.ZodError) {
    return {
      error: e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; "),
    };
  }
  console.error(e);
  return { error: "Something went wrong. Please try again." };
}

/**
 * Wrap a server action body for use with <ActionForm>. Known errors become a
 * message on the form; redirects/notFound pass through.
 */
export function formAction(fn: (formData: FormData) => Promise<ActionState | void>) {
  return async (_prev: ActionState, formData: FormData): Promise<ActionState> => {
    try {
      return (await fn(formData)) ?? { ok: true };
    } catch (e) {
      unstable_rethrow(e);
      return errorToState(e);
    }
  };
}
