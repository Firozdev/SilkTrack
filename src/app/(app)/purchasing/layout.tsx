import type { ReactNode } from "react";
import { requireSection } from "@/lib/session";

/** Not for every role (e.g. the BD warehouse) – checked on the server for every page here. */
export default async function Layout({ children }: { children: ReactNode }) {
  await requireSection("purchasing");
  return children;
}
