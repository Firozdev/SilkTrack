import "server-only";
import { prisma } from "@/lib/prisma";

export const CUSTOMER_FIELDS = { id: true, code: true, name: true, phone: true, email: true, address: true, district: true, area: true } as const;

/** Customers matching a name, phone or code fragment (for the request form lookup). */
export async function searchCustomers(q: string, take = 10) {
  const term = q.trim();
  if (term.length < 2) return [];
  const digits = term.replace(/\D/g, "");
  return prisma.customer.findMany({
    where: {
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { code: { contains: term, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ],
    },
    orderBy: [{ updatedAt: "desc" }],
    take,
    select: CUSTOMER_FIELDS,
  });
}

export type CustomerOption = Awaited<ReturnType<typeof searchCustomers>>[number];
