"use client";

import { CheckCircle2, CloudOff, Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@hirevine/ui/components/alert";
import { Badge } from "@hirevine/ui/components/badge";
import { Button } from "@hirevine/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hirevine/ui/components/dialog";
import { Input } from "@hirevine/ui/components/input";
import { Label } from "@hirevine/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hirevine/ui/components/select";
import { Switch } from "@hirevine/ui/components/switch";
import { Textarea } from "@hirevine/ui/components/textarea";
import { cn } from "@hirevine/ui/lib/utils";

export type Recommendation = "strong_yes" | "yes" | "maybe" | "no";

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  strong_yes: "Strong yes",
  yes: "Yes",
  maybe: "Maybe",
  no: "No",
};

export function RecommendationBadge({ value, suggested }: { value: Recommendation; suggested?: boolean }) {
  return (
    <Badge variant="outline" className={cn(value === "strong_yes" || value === "yes" ? "border-emerald-500/50" : "")}>
      {suggested ? <span className="text-muted-foreground">Suggested:</span> : null}
      {RECOMMENDATION_LABEL[value]}
    </Badge>
  );
}

export interface FeedbackValue {
  ai_draft: string | null;
  ai_recommendation: Recommendation | null;
  edited_text: string | null;
  recommendation: Recommendation | null;
  manager_note: string | null;
  excluded: boolean;
}

export interface FeedbackPatch {
  edited_text?: string | null;
  recommendation?: Recommendation | null;
  manager_note?: string | null;
  excluded?: boolean;
}

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * The feedback a candidate receives on release (frontend plan §7.5): the AI draft read-only, an
 * editable version (starting from the draft), the recommendation (the AI's shown as "Suggested"),
 * a private note and an exclude switch. Text autosaves 1 s after typing stops; choices save at once.
 */
export function FeedbackEditor({
  value,
  onSave,
  readOnly = false,
  saveDelayMs = 1000,
}: {
  value: FeedbackValue;
  onSave: (patch: FeedbackPatch) => Promise<unknown>;
  readOnly?: boolean;
  saveDelayMs?: number;
}) {
  const [text, setText] = useState(value.edited_text ?? value.ai_draft ?? "");
  const [note, setNote] = useState(value.manager_note ?? "");
  const [save, setSave] = useState<SaveState>("idle");
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((id) => clearTimeout(id));
  }, []);

  const send = async (patch: FeedbackPatch) => {
    setSave("saving");
    try {
      await onSave(patch);
      setSave("saved");
    } catch {
      setSave("error");
    }
  };
  const later = (key: string, patch: FeedbackPatch) => {
    const t = timers.current.get(key);
    if (t) clearTimeout(t);
    timers.current.set(key, setTimeout(() => void send(patch), saveDelayMs));
  };

  const edited = value.edited_text != null && value.edited_text !== value.ai_draft;
  return (
    <div className="grid gap-4">
      {value.ai_draft ? (
        <details className="rounded-md border bg-muted/30 p-3 text-sm" open={!edited}>
          <summary className="flex cursor-pointer items-center gap-1.5 font-medium">
            <Sparkles className="size-3.5" aria-hidden /> AI draft
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{value.ai_draft}</p>
        </details>
      ) : (
        <p className="text-sm text-muted-foreground">
          No AI draft yet. Write feedback here, or the candidate receives a short neutral message on release.
        </p>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="feedback-text">Feedback the candidate will see</Label>
        <Textarea
          id="feedback-text"
          rows={7}
          maxLength={4000}
          value={text}
          readOnly={readOnly}
          onChange={(e) => {
            setText(e.target.value);
            later("text", { edited_text: e.target.value });
          }}
        />
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="feedback-rec">Recommendation</Label>
          <Select
            value={value.recommendation ?? ""}
            disabled={readOnly}
            onValueChange={(v) => void send({ recommendation: v as Recommendation })}
          >
            <SelectTrigger id="feedback-rec" className="w-44">
              <SelectValue placeholder={value.ai_recommendation ? `Suggested: ${RECOMMENDATION_LABEL[value.ai_recommendation]}` : "Choose"} />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(RECOMMENDATION_LABEL) as Recommendation[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {RECOMMENDATION_LABEL[r]}
                  {r === value.ai_recommendation ? " (suggested)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch
            id="feedback-excluded"
            checked={value.excluded}
            disabled={readOnly}
            onCheckedChange={(c) => void send({ excluded: c })}
          />
          <Label htmlFor="feedback-excluded">Exclude from the final list</Label>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="feedback-note">Private note (never shown to the candidate)</Label>
        <Textarea
          id="feedback-note"
          rows={2}
          maxLength={2000}
          value={note}
          readOnly={readOnly}
          onChange={(e) => {
            setNote(e.target.value);
            later("note", { manager_note: e.target.value });
          }}
        />
      </div>
      <SaveState state={save} />
    </div>
  );
}

function SaveState({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  return (
    <span className={cn("flex items-center gap-1 text-xs", state === "error" ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
      {state === "saving" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
      {state === "saved" ? <CheckCircle2 className="size-3.5" aria-hidden /> : null}
      {state === "error" ? <CloudOff className="size-3.5" aria-hidden /> : null}
      {state === "saving" ? "Saving" : state === "saved" ? "Saved" : "Not saved — edit again to retry"}
    </span>
  );
}

/**
 * Completing is irreversible (frontend plan §7.6): the dialog says so, shows how many candidates
 * are released and how many still have an unedited AI draft, lets the notify setting change, and
 * asks for the job title to be typed.
 */
export function CompleteCampaignDialog({
  open,
  onOpenChange,
  jobTitle,
  total,
  unedited,
  inProgress,
  notifyDefault,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobTitle: string;
  total: number;
  unedited: number;
  inProgress: number;
  notifyDefault: boolean;
  pending: boolean;
  error?: string | null;
  onConfirm: (v: { confirm_title: string; notify: boolean }) => void;
}) {
  const [typed, setTyped] = useState("");
  const [notify, setNotify] = useState(notifyDefault);
  const matches = typed.trim().toLowerCase() === jobTitle.trim().toLowerCase();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete this campaign?</DialogTitle>
          <DialogDescription>This cannot be undone. The job closes to new applications.</DialogDescription>
        </DialogHeader>
        <ul className="grid list-disc gap-1 pl-5 text-sm">
          <li>
            Outcomes and feedback are released to all {total} candidate{total === 1 ? "" : "s"}.
          </li>
          {unedited ? (
            <li className="text-amber-700 dark:text-amber-400">
              {unedited} still {unedited === 1 ? "has" : "have"} an unedited AI draft or no feedback (a neutral message is sent).
            </li>
          ) : null}
          {inProgress ? <li>{inProgress} {inProgress === 1 ? "is" : "are"} still mid-process and will be closed as they are.</li> : null}
        </ul>
        <div className="flex items-center gap-2">
          <Switch id="complete-notify" checked={notify} onCheckedChange={setNotify} />
          <Label htmlFor="complete-notify">Notify candidates in the app</Label>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="complete-title">
            Type <span className="font-semibold">{jobTitle}</span> to confirm
          </Label>
          <Input id="complete-title" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!matches || pending} onClick={() => onConfirm({ confirm_title: typed, notify })}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Complete and release
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
