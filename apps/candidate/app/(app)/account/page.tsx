"use client";

import { messageFor } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { Alert, AlertDescription, AlertTitle } from "@hirevine/ui/components/alert";
import { Button } from "@hirevine/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@hirevine/ui/components/card";
import { Input } from "@hirevine/ui/components/input";
import { Label } from "@hirevine/ui/components/label";
import { Download, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { notificationHref, notificationText, useDeleteAccount, useExport, useNotificationActions, useNotifications } from "@/lib/account";

/** Account and privacy (frontend plan §8.8, Phase 9): notifications, data export and deletion. */
export default function AccountPage() {
  const notes = useNotifications();
  const { read, readAll } = useNotificationActions();
  const exp = useExport();
  const del = useDeleteAccount();
  const [confirm, setConfirm] = useState("");

  return (
    <>
      <PageHeader title="Account" description="Notifications and your data." />
      <div className="grid max-w-3xl gap-4">
        <Card id="notifications">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Notifications</CardTitle>
              <CardDescription>Invitations to the next step and released outcomes.</CardDescription>
            </div>
            {notes.data?.unread ? (
              <Button variant="outline" size="sm" onClick={() => readAll.mutate()} disabled={readAll.isPending}>
                Mark all as read
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {notes.isError ? (
              <p className="text-sm text-destructive">{messageFor(notes.error)}</p>
            ) : !notes.data ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : notes.data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet. We&apos;ll let you know when there&apos;s news.</p>
            ) : (
              <ul className="divide-y">
                {notes.data.items.map((n) => (
                  <li key={n.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                    <Link
                      href={notificationHref(n)}
                      onClick={() => !n.read && read.mutate(n.id)}
                      className={n.read ? "text-muted-foreground hover:underline" : "font-medium hover:underline"}
                    >
                      {!n.read ? <span className="mr-2 inline-block size-2 rounded-full bg-primary" aria-label="Unread" /> : null}
                      {notificationText(n)}
                    </Link>
                    <time className="shrink-0 text-xs text-muted-foreground" dateTime={n.created_at}>
                      {new Date(n.created_at).toLocaleDateString()}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Download your data</CardTitle>
            <CardDescription>
              One JSON file with your profile, applications, answers, interview transcripts, released results and feedback,
              plus a link to each resume you uploaded (valid for 24 hours).
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-2">
            <Button variant="outline" onClick={() => exp.mutate()} disabled={exp.isPending}>
              {exp.isPending ? <Loader2 className="animate-spin" /> : <Download />}
              Download my data
            </Button>
            {exp.isError ? <p className="text-sm text-destructive">{messageFor(exp.error)}</p> : null}
          </CardFooter>
        </Card>

        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">Delete your account</CardTitle>
            <CardDescription>
              This permanently deletes your account, your resumes, the text read from them, your answers, interview transcripts,
              results, feedback and notifications. Hiring teams will no longer see your applications. It cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Label htmlFor="delete-confirm">Type DELETE to confirm</Label>
            <Input id="delete-confirm" className="max-w-56" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
            {del.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Could not delete</AlertTitle>
                <AlertDescription>{messageFor(del.error)}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter>
            <Button variant="destructive" disabled={confirm.trim().toUpperCase() !== "DELETE" || del.isPending} onClick={() => del.mutate(confirm)}>
              {del.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Delete my account
            </Button>
          </CardFooter>
        </Card>
        <p className="text-xs text-muted-foreground">
          See the <Link className="underline" href="/privacy">privacy notice</Link>, <Link className="underline" href="/terms">terms</Link> and{" "}
          <Link className="underline" href="/ai-evaluation">how AI evaluation works</Link>.
        </p>
      </div>
    </>
  );
}
