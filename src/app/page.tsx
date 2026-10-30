import { Suspense } from "react";
import Board from "@/components/Board";
import { PageSkeleton } from "@/components/ui";

export const metadata = { title: "Status board" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton kind="cards" />}>
      <Board />
    </Suspense>
  );
}
