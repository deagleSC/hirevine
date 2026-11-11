"use client";

import { qk, toApiError, unwrap, type components } from "@hirevine/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";
import { env } from "./env";
import { supabase } from "./supabase";

export type NotificationList = components["schemas"]["NotificationList"];
export type Notification = components["schemas"]["Notification"];

export function useNotifications() {
  return useQuery({
    queryKey: qk.myNotifications(),
    queryFn: () => unwrap(api.GET("/v1/candidate/notifications")),
    refetchInterval: 60_000,
  });
}

export function useNotificationActions() {
  const qc = useQueryClient();
  const set = (n: NotificationList) => qc.setQueryData(qk.myNotifications(), n);
  const readAll = useMutation({ mutationFn: () => unwrap(api.POST("/v1/candidate/notifications/read-all")), onSuccess: set });
  const read = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST("/v1/candidate/notifications/{notification_id}/read", { params: { path: { notification_id: id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.myNotifications() }),
  });
  return { read, readAll };
}

/** Where a notification leads. */
export function notificationHref(n: Notification): string {
  if (!n.application_id) return "/applications";
  if (n.type === "outcome_released") return `/applications/${n.application_id}/feedback`;
  if (n.type === "stage_invited" && n.stage) return `/applications/${n.application_id}/${n.stage}`;
  return `/applications/${n.application_id}`;
}

export function notificationText(n: Notification): string {
  const job = n.job_title ?? "your application";
  if (n.type === "outcome_released") return `The outcome for ${job} is ready.`;
  if (n.type === "stage_invited") return `You're invited to the ${n.stage === "interview" ? "AI interview" : "skills quiz"} for ${job}.`;
  return `Update on ${job}.`;
}

/** Download everything stored about the signed-in candidate as a JSON file. */
export function useExport() {
  return useMutation({
    mutationFn: async () => {
      const token = (await supabase().auth.getSession()).data.session?.access_token;
      let res: Response;
      try {
        res = await fetch(`${env.apiUrl}/v1/candidate/privacy/export`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      } catch {
        throw toApiError(0, null);
      }
      if (!res.ok) throw toApiError(res.status, await res.json().catch(() => null));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hirevine-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: (confirm: string) => unwrap(api.POST("/v1/candidate/privacy/delete", { body: { confirm } })),
    onSuccess: async () => {
      await supabase().auth.signOut();
      window.location.assign("/?deleted=1");
    },
  });
}
