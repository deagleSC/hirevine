"use client";

import { Button } from "@hirevine/ui/components/button";
import { Bell } from "lucide-react";
import Link from "next/link";

import { useNotifications } from "@/lib/account";

/** Header bell: unread count, linking to the account page's notifications. */
export function NotificationsBell() {
  const n = useNotifications();
  const unread = n.data?.unread ?? 0;
  return (
    <Button asChild variant="ghost" size="icon" className="relative">
      <Link href="/account#notifications" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
        <Bell />
        {unread ? (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}
