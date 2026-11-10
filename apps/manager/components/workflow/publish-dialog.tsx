"use client";

import { messageFor } from "@hirevine/api-client";
import { Button } from "@hirevine/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@hirevine/ui/components/dialog";
import { Input } from "@hirevine/ui/components/input";
import { Spinner } from "@hirevine/ui/components/spinner";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { candidateAppUrl, usePublish } from "@/lib/jobs";

export function shareUrl(slug: string) {
  return `${candidateAppUrl()}/a/${slug}`;
}

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input readOnly value={url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Copy link"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

export function PublishDialog({ jobId, version, open, onOpenChange }: { jobId: string; version: number; open: boolean; onOpenChange: (o: boolean) => void }) {
  const publish = usePublish(jobId);
  const done = publish.data;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{done ? "Published" : "Publish this job?"}</DialogTitle>
          <DialogDescription>
            {done
              ? "Candidates can apply now. Share this link anywhere."
              : `Version ${version} of the pipeline is frozen for this campaign, and a shareable apply link is created. You can still edit the pipeline; changes apply only to candidates who haven't reached the changed step.`}
          </DialogDescription>
        </DialogHeader>
        {done ? <CopyLink url={shareUrl(done.share_slug)} /> : null}
        <DialogFooter>
          {done ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={publish.isPending}>
                Cancel
              </Button>
              <Button
                disabled={publish.isPending}
                onClick={() => publish.mutate(undefined, { onError: (err) => toast.error(messageFor(err)) })}
              >
                {publish.isPending ? <Spinner /> : null}
                Publish
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
