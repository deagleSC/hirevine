import { Button } from "@hirevine/ui/components/button";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto grid max-w-xl justify-items-center gap-4 px-4 py-24 text-center">
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
      <Button asChild>
        <Link href="/">Back to home</Link>
      </Button>
    </div>
  );
}
