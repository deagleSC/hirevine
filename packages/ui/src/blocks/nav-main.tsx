"use client";

import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@hirevine/ui/components/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@hirevine/ui/components/sidebar";

export type NavItem = {
  title: string;
  url: string;
  icon?: LucideIcon;
  items?: { title: string; url: string }[];
};

/** Longest nav href matching the path, so `/jobs` does not win over `/jobs/new`. */
function activeUrl(pathname: string, items: NavItem[]): string | null {
  const urls = items.flatMap((i) => [i.url, ...(i.items ?? []).map((s) => s.url)]);
  const matches = urls.filter((u) => pathname === u || (u !== "/" && pathname.startsWith(`${u}/`)));
  return matches.reduce<string | null>((a, b) => (a && a.length >= b.length ? a : b), null);
}

/** shadcn sidebar-07 NavMain, with Next links and active-route highlighting. */
export function NavMain({ items, label = "Navigation" }: { items: NavItem[]; label?: string }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const active = useMemo(() => (pathname ? activeUrl(pathname, items) : null), [pathname, items]);
  const onNavigate = () => isMobile && setOpenMobile(false);

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) =>
          item.items?.length ? (
            <Collapsible
              key={item.title}
              asChild
              defaultOpen={item.items.some((s) => s.url === active)}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={item.title}>
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items.map((sub) => (
                      <SidebarMenuSubItem key={sub.title}>
                        <SidebarMenuSubButton asChild isActive={active === sub.url}>
                          <Link href={sub.url} onClick={onNavigate}>
                            <span>{sub.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          ) : (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild tooltip={item.title} isActive={active === item.url}>
                <Link href={item.url} onClick={onNavigate}>
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ),
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}
