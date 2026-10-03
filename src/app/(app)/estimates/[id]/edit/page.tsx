import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePagePermission } from "@/lib/session";

// Editing a draft uses the same form as a new quotation.
export default async function EditQuotationPage({ params }: PageProps<"/estimates/[id]/edit">) {
  await requirePagePermission("estimate:edit");
  const { id } = await params;
  const e = await prisma.estimate.findUnique({ where: { id }, select: { orderId: true } });
  if (!e) notFound();
  redirect(`/estimates/new?order=${e.orderId}`);
}
