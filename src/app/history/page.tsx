import { Suspense } from "react";
import History from "@/components/History";
import { PageSkeleton } from "@/components/ui";

export const metadata = { title: "Fault history" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton kind="table" />}>
      <History />
    </Suspense>
  );
}
