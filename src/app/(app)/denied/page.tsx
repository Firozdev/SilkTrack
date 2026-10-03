import { A, PageHeader } from "@/components/ui";

export default function Denied() {
  return (
    <>
      <PageHeader title="Not allowed" subtitle="Your role does not have access to that page." />
      <A href="/">Back to dashboard</A>
    </>
  );
}
