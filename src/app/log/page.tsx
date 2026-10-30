import { Suspense } from "react";
import EmailLog from "@/components/EmailLog";
import { PageSkeleton } from "@/components/ui";

export const metadata = { title: "Email log" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton kind="table" />}>
      <EmailLog />
    </Suspense>
  );
}
