"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formAction } from "@/lib/action";
import { fields, zDecOpt, zStrOpt } from "@/lib/forms";
import { requireUser } from "@/lib/session";
import { approveSubmission, rejectSubmission } from "@/server/payment-submissions";

const METHOD = z.enum(["CASH", "BKASH", "NAGAD", "ROCKET", "BANK_TRANSFER", "CARD", "OTHER"]);

export const approveSubmissionAction = formAction(async (fd) => {
  const user = await requireUser();
  const f = z
    .object({ id: z.string().min(1), amountBdt: zDecOpt, method: METHOD.optional(), reference: zStrOpt, type: z.enum(["ADVANCE", "BALANCE"]).optional() })
    .parse(fields(fd));
  await approveSubmission(user, f.id, f);
  revalidatePath("/payments-to-verify");
  return { ok: true, message: "Approved – payment recorded." };
});

export const rejectSubmissionAction = formAction(async (fd) => {
  const user = await requireUser();
  const f = z.object({ id: z.string().min(1), reason: z.string().trim().min(1, "Give a reason the customer will see") }).parse(fields(fd));
  await rejectSubmission(user, f.id, f.reason);
  revalidatePath("/payments-to-verify");
  return { ok: true, message: "Rejected." };
});
