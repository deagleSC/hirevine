"use client";

import { messageFor, type Patch } from "@hirevine/api-client";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@hirevine/ui/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@hirevine/ui/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@hirevine/ui/ai-elements/prompt-input";
import { Suggestion } from "@hirevine/ui/ai-elements/suggestion";
import { Button } from "@hirevine/ui/components/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@hirevine/ui/components/sheet";
import { Spinner } from "@hirevine/ui/components/spinner";
import { MessageSquareText } from "lucide-react";
import { useState } from "react";

import { overrideChat, type OverrideResult } from "@/lib/jobs";

interface Turn {
  message: string;
  result?: OverrideResult;
  error?: string;
}

const STARTERS = ["Raise the screening cutoff to 70", "Skip the quiz", "Limit the interview to 5 questions"];

/** "Edit by chat" (frontend plan §198): proposals join the same preview → apply flow. */
export function ChatDrawer({
  jobId,
  open,
  onOpenChange,
  onPropose,
  busy,
}: {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPropose: (patches: Patch[]) => void;
  busy: boolean;
}) {
  const [threadId, setThreadId] = useState<string>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sending, setSending] = useState(false);

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setTurns((t) => [...t, { message }]);
    try {
      const result = await overrideChat(jobId, message, threadId);
      setThreadId(result.thread_id);
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, result } : x)));
    } catch (err) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: messageFor(err) } : x)));
      throw err; // keep the text in the input for a retry
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit by chat</SheetTitle>
          <SheetDescription>Say what to change. You review every change before it is applied.</SheetDescription>
        </SheetHeader>
        <Conversation className="min-h-0 flex-1">
          <ConversationContent>
            {turns.length === 0 ? (
              <ConversationEmptyState>
                <MessageSquareText className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">For example:</p>
                <div className="flex flex-col items-center gap-2">
                  {STARTERS.map((s) => (
                    <Suggestion key={s} suggestion={s} onClick={(t) => void send(t).catch(() => {})} />
                  ))}
                </div>
              </ConversationEmptyState>
            ) : null}
            {turns.map((t, i) => (
              <div key={i} className="flex flex-col gap-4">
                <Message from="user">
                  <MessageContent>{t.message}</MessageContent>
                </Message>
                <Message from="assistant">
                  <MessageContent>
                    {!t.result && !t.error ? (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Spinner /> Working out the changes…
                      </span>
                    ) : null}
                    {t.error ? <p className="text-destructive">{t.error}</p> : null}
                    {t.result ? (
                      <div className="flex flex-col gap-2">
                        <MessageResponse>{t.result.explanation}</MessageResponse>
                        {t.result.error ? (
                          <p className="text-destructive">Couldn't turn that into a valid change. Try rephrasing.</p>
                        ) : null}
                        {t.result.descriptions.length ? (
                          <>
                            <ul className="list-disc pl-5">
                              {t.result.descriptions.map((d) => (
                                <li key={d}>{d}</li>
                              ))}
                            </ul>
                            <Button
                              size="sm"
                              className="self-start"
                              disabled={busy}
                              onClick={() => onPropose(t.result!.patches as Patch[])}
                            >
                              Review changes
                            </Button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </MessageContent>
                </Message>
              </div>
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        <div className="border-t p-4">
          <PromptInputProvider>
            <PromptInput onSubmit={(m: PromptInputMessage) => send(m.text)}>
              <PromptInputBody>
                <PromptInputTextarea aria-label="Change request" maxLength={2000} placeholder="e.g. make TypeScript a must-have" />
              </PromptInputBody>
              <PromptInputFooter>
                <PromptInputTools />
                <PromptInputSubmit status={sending ? "submitted" : undefined} disabled={sending} aria-label="Send" />
              </PromptInputFooter>
            </PromptInput>
          </PromptInputProvider>
        </div>
      </SheetContent>
    </Sheet>
  );
}
