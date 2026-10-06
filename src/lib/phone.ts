/**
 * Bangladesh mobile number in local form 01XXXXXXXXX, from "+880 1711-000000",
 * "8801711000000", "01711000000"… Null if it isn't a valid BD mobile number.
 */
export function normalizeBdPhone(input: string): string | null {
  let d = input.replace(/\D/g, "");
  if (d.startsWith("880")) d = "0" + d.slice(3);
  else if (d.startsWith("1") && d.length === 10) d = "0" + d;
  return /^01[3-9]\d{8}$/.test(d) ? d : null;
}

/** Ways the same number may already be stored on a Customer (stored with + and digits only). */
export function phoneVariants(local: string): string[] {
  const rest = local.slice(1);
  return [local, `880${rest}`, `+880${rest}`];
}
