import { Suspense } from "react";
import Forms from "@/components/Forms";
import { PageSkeleton } from "@/components/ui";

export const metadata = { title: "F3.21 forms" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton kind="form" />}>
      <Forms />
    </Suspense>
  );
}
