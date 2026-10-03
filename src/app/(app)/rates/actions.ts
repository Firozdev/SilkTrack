"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formAction } from "@/lib/action";
import { fields, zDec, zDecOpt, zStrOpt, zYmd } from "@/lib/forms";
import { requireUser } from "@/lib/session";
import { saveRate } from "@/server/rates";

const schema = z.object({
  date: zYmd,
  rate: zDec,
  buyingRate: zDecOpt,
  sellingRate: zDecOpt,
  note: zStrOpt,
});

export const saveRateAction = formAction(async (fd) => {
  const user = await requireUser();
  const input = schema.parse(fields(fd));
  await saveRate(user, input);
  revalidatePath("/", "layout");
  return { ok: true, message: `Rate for ${input.date} saved.` };
});
