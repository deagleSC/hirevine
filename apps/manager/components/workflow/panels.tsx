"use client";

import {
  CriterionSchema,
  messageFor,

  RubricItemSchema,
  diffFormToPatches,
  formFromNode,
  type NodeForm,
  type Patch,
  type Workflow,
  type WorkflowNode,
} from "@hirevine/api-client";
import { Badge } from "@hirevine/ui/components/badge";
import { Button } from "@hirevine/ui/components/button";
import { Checkbox } from "@hirevine/ui/components/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@hirevine/ui/components/field";
import { Input } from "@hirevine/ui/components/input";
import { RadioGroup, RadioGroupItem } from "@hirevine/ui/components/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hirevine/ui/components/select";
import { Slider } from "@hirevine/ui/components/slider";
import { Switch } from "@hirevine/ui/components/switch";
import { Textarea } from "@hirevine/ui/components/textarea";
import { cn } from "@hirevine/ui/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { ListChecks, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Controller, useFieldArray, useForm, type Control, type FieldValues, type UseFormRegister } from "react-hook-form";
import { z } from "zod";

import { useGenerateQuiz, useQuizGeneration, type GenerateRequest } from "@/lib/jobs";

import { STAGE_LABEL } from "./canvas";

const percent = z.number().int().min(0).max(100);
const draftId = z.string().optional();

const screeningSchema = z.object({
  cutoff: percent,
  criteria: z.array(CriterionSchema.extend({ id: draftId })).min(1, "Keep at least one criterion").max(20),
});
const quizSchema = z.object({
  enabled: z.boolean(),
  pass_mark: percent,
  time_limit_min: z.number().int().min(5).max(120),
  questions: z.array(
    z.object({
      id: draftId,
      prompt: z.string().trim().min(1, "Write the question").max(1000),
      options: z.array(z.string().trim().min(1, "Fill in the option").max(300)).min(3).max(5),
      answer_index: z.number().int().min(0),
      explanation: z.string().max(1000),
      difficulty: z.enum(["easy", "medium", "hard"]),
    }),
  ),
});
const interviewSchema = z.object({
  enabled: z.boolean(),
  prompt_additions: z.string().max(2000),
  themes_text: z.string(),
  turn_cap: z.number().int().min(3).max(10),
  rubric: z.array(RubricItemSchema),
  pass_threshold: percent,
});
const finalSchema = z.object({ notify_on_complete: z.boolean() });


interface PanelProps {
  jobId?: string;
  base: Workflow;
  node: WorkflowNode;
  onPropose: (patches: Patch[]) => void;
  busy: boolean;
  readOnly?: boolean;
}

function Footer({ busy, readOnly, onReset, dirty }: { busy: boolean; readOnly?: boolean; onReset: () => void; dirty: boolean }) {
  if (readOnly) return null;
  return (
    <div className="sticky bottom-0 -mx-6 mt-2 flex justify-end gap-2 border-t bg-card px-6 py-4">
      <Button type="button" variant="ghost" onClick={onReset} disabled={!dirty || busy}>
        Reset
      </Button>
      <Button type="submit" disabled={!dirty || busy}>
        Review changes
      </Button>
    </div>
  );
}

function PercentSlider<T extends FieldValues>({ control, name, label, hint }: { control: Control<T>; name: string; label: string; hint?: string }) {
  return (
    <Controller
      control={control}
      name={name as never}
      render={({ field }) => (
        <Field>
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor={name}>{label}</FieldLabel>
            <span className="text-sm tabular-nums">{field.value as number}</span>
          </div>
          <Slider id={name} min={0} max={100} step={1} value={[field.value as number]} onValueChange={([v]) => field.onChange(v)} />
          {hint ? <FieldDescription>{hint}</FieldDescription> : null}
        </Field>
      )}
    />
  );
}

function NumberInput<T extends FieldValues>({ register, name, label, min, max }: { register: UseFormRegister<T>; name: string; label: string; min: number; max: number }) {
  return (
    <Field>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input id={name} type="number" min={min} max={max} {...register(name as never, { valueAsNumber: true })} />
    </Field>
  );
}

// ------------------------------------------------------------------ screening
function ScreeningPanel({ base, node, onPropose, busy, readOnly }: PanelProps) {
  const initial = formFromNode(node) as z.infer<typeof screeningSchema>;
  const form = useForm({ resolver: zodResolver(screeningSchema), defaultValues: initial });
  const rows = useFieldArray({ control: form.control, name: "criteria" });
  const submit = form.handleSubmit((v) => onPropose(diffFormToPatches(base, node.id, v as NodeForm)));
  const err = form.formState.errors;
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <fieldset disabled={readOnly} className="contents">
        <PercentSlider control={form.control} name="cutoff" label="Cutoff" hint="Resumes that score below this don't move on." />
        <FieldSet>
          <FieldLegend variant="label">Criteria</FieldLegend>
          <div className="flex flex-col gap-2">
            {rows.fields.map((row, i) => (
              <div key={row.id} className="grid grid-cols-[1fr_4.5rem_auto_auto] items-center gap-2">
                <Input aria-label={`Criterion ${i + 1} name`} {...form.register(`criteria.${i}.name`)} />
                <Input aria-label={`Criterion ${i + 1} weight`} type="number" min={1} max={5} {...form.register(`criteria.${i}.weight`, { valueAsNumber: true })} />
                <Controller
                  control={form.control}
                  name={`criteria.${i}.must_have`}
                  render={({ field }) => (
                    <label className="flex items-center gap-1.5 text-xs">
                      <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
                      Must-have
                    </label>
                  )}
                />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove criterion ${i + 1}`} onClick={() => rows.remove(i)}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
          {err.criteria?.root?.message || err.criteria?.message ? <FieldError>{err.criteria?.root?.message ?? err.criteria?.message}</FieldError> : null}
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => rows.append({ name: "", weight: 3, must_have: false })}>
            <Plus /> Add criterion
          </Button>
          <FieldDescription>Weight 1–5. A must-have criterion that isn't met flags the resume.</FieldDescription>
        </FieldSet>
      </fieldset>
      <Footer busy={busy} readOnly={readOnly} dirty={form.formState.isDirty} onReset={() => form.reset(initial)} />
    </form>
  );
}

// ----------------------------------------------------------------------- quiz
const LETTERS = "ABCDE";

function QuestionEditor({ form, index, onRemove }: { form: ReturnType<typeof useForm<z.infer<typeof quizSchema>>>; index: number; onRemove: () => void }) {
  const options = form.watch(`questions.${index}.options`);
  const errs = form.formState.errors.questions?.[index];
  const base = `q${index}`;
  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
        <span className="flex-1 text-sm font-medium">Question {index + 1}</span>
        <Controller
          control={form.control}
          name={`questions.${index}.difficulty`}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger size="sm" aria-label="Difficulty" className="w-24 sm:w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="easy">Easy</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="hard">Hard</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        <Button type="button" variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" aria-label={`Remove question ${index + 1}`} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>

      <Field data-invalid={!!errs?.prompt}>
        <FieldLabel htmlFor={`${base}-prompt`} className="sr-only">
          Question {index + 1}
        </FieldLabel>
        <Textarea id={`${base}-prompt`} rows={2} placeholder="Write the question…" aria-invalid={!!errs?.prompt} {...form.register(`questions.${index}.prompt`)} />
        {errs?.prompt ? <FieldError>{errs.prompt.message}</FieldError> : null}
      </Field>

      <Controller
        control={form.control}
        name={`questions.${index}.answer_index`}
        render={({ field }) => (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-muted-foreground">Options</span>
              <span className="text-xs text-muted-foreground">Select the correct answer</span>
            </div>
            <RadioGroup value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))} aria-label="Correct option" className="gap-2">
              {options.map((_, oi) => {
                const correct = field.value === oi;
                const err = errs?.options?.[oi];
                return (
                  <div key={oi} className="flex flex-col gap-1">
                    <div
                      className={cn(
                        "flex items-center gap-2 rounded-md border bg-background py-1 pr-1 pl-2.5 transition-colors",
                        correct && "border-primary/60 bg-primary/5",
                        err && "border-destructive",
                      )}
                    >
                      <RadioGroupItem value={String(oi)} aria-label={`Option ${LETTERS[oi]} is correct`} />
                      <span className="w-3 text-xs font-medium text-muted-foreground">{LETTERS[oi]}</span>
                      <Input
                        aria-label={`Option ${LETTERS[oi]}`}
                        placeholder={`Option ${LETTERS[oi]}`}
                        className="h-8 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
                        {...form.register(`questions.${index}.options.${oi}`)}
                      />
                      {correct ? <Badge className="hidden shrink-0 sm:inline-flex">Correct</Badge> : null}
                      {options.length > 3 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0 text-muted-foreground"
                          aria-label={`Remove option ${LETTERS[oi]}`}
                          onClick={() => {
                            const next = options.filter((__, j) => j !== oi);
                            form.setValue(`questions.${index}.options`, next, { shouldDirty: true });
                            if (field.value === oi) field.onChange(0);
                            else if (field.value > oi) field.onChange(field.value - 1);
                          }}
                        >
                          <X />
                        </Button>
                      ) : null}
                    </div>
                    {err?.message ? <FieldError>{err.message}</FieldError> : null}
                  </div>
                );
              })}
            </RadioGroup>
            {options.length < 5 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start text-muted-foreground"
                onClick={() => form.setValue(`questions.${index}.options`, [...options, ""], { shouldDirty: true })}
              >
                <Plus /> Add option
              </Button>
            ) : null}
          </div>
        )}
      />

      <Field>
        <FieldLabel htmlFor={`${base}-explanation`} className="text-xs text-muted-foreground">
          Explanation <span className="font-normal">(optional)</span>
        </FieldLabel>
        <Textarea id={`${base}-explanation`} rows={2} placeholder="Why the correct answer is right" {...form.register(`questions.${index}.explanation`)} />
      </Field>
    </div>
  );
}

function GenerateQuestions({ jobId, existing, disabled, dirty }: { jobId: string; existing: number; disabled: boolean; dirty: boolean }) {
  const [count, setCount] = useState(Math.min(10, Math.max(1, 30 - existing)) || 10);
  const [difficulty, setDifficulty] = useState<GenerateRequest["difficulty"]>("mixed");
  const [replace, setReplace] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const generate = useGenerateQuiz(jobId);
  const status = useQuizGeneration(jobId, runId);
  const running = generate.isPending || (!!runId && (!status.data || !["done", "failed"].includes(status.data.status)));
  const room = replace ? 30 : 30 - existing;

  return (
    <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4" aria-hidden /> Generate from the job and rubric
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field>
          <FieldLabel htmlFor="gen-count">Questions</FieldLabel>
          <Input id="gen-count" type="number" min={1} max={Math.max(1, room)} value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} disabled={disabled || running} />
        </Field>
        <Field>
          <FieldLabel htmlFor="gen-difficulty">Difficulty</FieldLabel>
          <Select value={difficulty} onValueChange={(v) => setDifficulty(v as GenerateRequest["difficulty"])} disabled={disabled || running}>
            <SelectTrigger id="gen-difficulty"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mixed">Mixed</SelectItem>
              <SelectItem value="easy">Easy</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="hard">Hard</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      {existing > 0 ? (
        <Field orientation="horizontal">
          <Checkbox id="gen-replace" checked={replace} onCheckedChange={(v) => setReplace(v === true)} disabled={disabled || running} />
          <FieldLabel htmlFor="gen-replace" className="font-normal">Replace the current {existing} question{existing === 1 ? "" : "s"}</FieldLabel>
        </Field>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        disabled={disabled || running || count > room}
        onClick={() => generate.mutate({ count, difficulty, replace }, { onSuccess: (r) => setRunId(r.job_run_id) })}
      >
        {running ? <Loader2 className="animate-spin" /> : <Sparkles />}
        {running ? (status.data?.status === "deferred_budget" ? "Queued until the AI budget resets" : "Generating…") : "Generate questions"}
      </Button>
      {dirty ? <FieldDescription>Save or reset your edits first; generated questions are added as a new version.</FieldDescription> : null}
      {count > room ? <FieldDescription>A quiz holds at most 30 questions.</FieldDescription> : null}
      {generate.isError ? <p className="text-sm text-destructive">{messageFor(generate.error)}</p> : null}
      {status.data?.status === "failed" ? <p className="text-sm text-destructive">{status.data.error ?? "Generation failed."}</p> : null}
      <FieldDescription>Review every generated question before publishing; you can edit or remove any of them.</FieldDescription>
    </div>
  );
}

function QuizPanel({ jobId, base, node, onPropose, busy, readOnly }: PanelProps) {
  const initial = formFromNode(node) as z.infer<typeof quizSchema>;
  const form = useForm({ resolver: zodResolver(quizSchema), defaultValues: initial });
  const qs = useFieldArray({ control: form.control, name: "questions" });
  const submit = form.handleSubmit((v) => onPropose(diffFormToPatches(base, node.id, v as NodeForm)));
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <fieldset disabled={readOnly} className="contents">
        <Controller
          control={form.control}
          name="enabled"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Switch id="quiz-enabled" checked={field.value} onCheckedChange={field.onChange} />
              <FieldLabel htmlFor="quiz-enabled">Include the quiz</FieldLabel>
            </Field>
          )}
        />
        <PercentSlider control={form.control} name="pass_mark" label="Pass mark" />
        <NumberInput register={form.register} name="time_limit_min" label="Time limit (minutes)" min={5} max={120} />
        <FieldSet>
          <FieldLegend variant="label">Questions ({qs.fields.length})</FieldLegend>
          {jobId ? (
            <GenerateQuestions jobId={jobId} existing={qs.fields.length} dirty={form.formState.isDirty}
              disabled={!!readOnly || busy || form.formState.isDirty} />
          ) : null}
          {qs.fields.length === 0 ? (
            <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center">
              <ListChecks className="mb-1 size-5 text-muted-foreground" />
              <p className="text-sm font-medium">No questions yet</p>
              <p className="text-xs text-muted-foreground">Add multiple-choice questions candidates answer in this step.</p>
            </div>
          ) : null}
          {qs.fields.map((q, i) => (
            <QuestionEditor key={q.id} form={form} index={i} onRemove={() => qs.remove(i)} />
          ))}
          <Button
            type="button"
            variant="outline"
            className="w-full border-dashed"
            disabled={qs.fields.length >= 30}
            onClick={() => qs.append({ prompt: "", options: ["", "", ""], answer_index: 0, explanation: "", difficulty: "medium" })}
          >
            <Plus /> Add question
          </Button>
        </FieldSet>
      </fieldset>
      <Footer busy={busy} readOnly={readOnly} dirty={form.formState.isDirty} onReset={() => form.reset(initial)} />
    </form>
  );
}

// ------------------------------------------------------------------ interview
function InterviewPanel({ base, node, onPropose, busy, readOnly }: PanelProps) {
  const start = formFromNode(node) as { themes: string[] } & Omit<z.infer<typeof interviewSchema>, "themes_text">;
  const initial: z.infer<typeof interviewSchema> = { ...start, themes_text: start.themes.join("\n") };
  const form = useForm({ resolver: zodResolver(interviewSchema), defaultValues: initial });
  const rubric = useFieldArray({ control: form.control, name: "rubric" });
  const submit = form.handleSubmit(({ themes_text, ...v }) => {
    const themes = themes_text.split("\n").map((t) => t.trim()).filter(Boolean).slice(0, 10);
    onPropose(diffFormToPatches(base, node.id, { ...v, themes } as NodeForm));
  });
  const taken = new Set(rubric.fields.map((r) => r.id));
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <fieldset disabled={readOnly} className="contents">
        <Controller
          control={form.control}
          name="enabled"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Switch id="interview-enabled" checked={field.value} onCheckedChange={field.onChange} />
              <FieldLabel htmlFor="interview-enabled">Include the AI interview</FieldLabel>
            </Field>
          )}
        />
        <Field>
          <FieldLabel htmlFor="prompt_additions">Prompt additions</FieldLabel>
          <Textarea id="prompt_additions" rows={4} maxLength={2000} {...form.register("prompt_additions")} />
          <FieldDescription>
            Added inside a fixed wrapper that keeps the interview fair and on-topic. The interviewer always says it is an AI
            and never asks about protected characteristics.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="themes_text">Themes</FieldLabel>
          <Textarea id="themes_text" rows={3} placeholder="One per line" {...form.register("themes_text")} />
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Rubric</FieldLegend>
          {rubric.fields.map((r, i) => (
            <div key={r.id} className="grid grid-cols-[1fr_4.5rem_auto] items-center gap-2">
              <Input aria-label={`Rubric item ${i + 1}`} {...form.register(`rubric.${i}.name`)} />
              <Input aria-label={`Rubric item ${i + 1} weight`} type="number" min={1} max={5} {...form.register(`rubric.${i}.weight`, { valueAsNumber: true })} />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove rubric item ${i + 1}`} onClick={() => rubric.remove(i)}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={rubric.fields.length >= 10}
            onClick={() => {
              let n = rubric.fields.length + 1;
              while (taken.has(`r${n}`)) n += 1;
              rubric.append({ id: `r${n}`, name: "", weight: 3, description: "" });
            }}
          >
            <Plus /> Add rubric item
          </Button>
        </FieldSet>
        <Controller
          control={form.control}
          name="turn_cap"
          render={({ field }) => (
            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="turn_cap">Number of questions</FieldLabel>
                <span className="text-sm tabular-nums">{field.value}</span>
              </div>
              <Slider id="turn_cap" min={3} max={10} step={1} value={[field.value]} onValueChange={([v]) => field.onChange(v)} />
            </Field>
          )}
        />
        <PercentSlider control={form.control} name="pass_threshold" label="Pass mark" />
      </fieldset>
      <Footer busy={busy} readOnly={readOnly} dirty={form.formState.isDirty} onReset={() => form.reset(initial)} />
    </form>
  );
}

// ---------------------------------------------------------------------- final
function FinalPanel({ base, node, onPropose, busy, readOnly }: PanelProps) {
  const initial = formFromNode(node) as z.infer<typeof finalSchema>;
  const form = useForm({ resolver: zodResolver(finalSchema), defaultValues: initial });
  const submit = form.handleSubmit((v) => onPropose(diffFormToPatches(base, node.id, v)));
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <fieldset disabled={readOnly} className="contents">
        <FieldGroup>
          <Controller
            control={form.control}
            name="notify_on_complete"
            render={({ field }) => (
              <Field orientation="horizontal">
                <Switch id="notify" checked={field.value} onCheckedChange={field.onChange} />
                <FieldLabel htmlFor="notify">Notify candidates when the campaign completes</FieldLabel>
              </Field>
            )}
          />
          <Field>
            <FieldLabel>Ranking</FieldLabel>
            <p className="text-sm text-muted-foreground">Weighted mean of stage scores (fixed in this version).</p>
          </Field>
        </FieldGroup>
      </fieldset>
      <Footer busy={busy} readOnly={readOnly} dirty={form.formState.isDirty} onReset={() => form.reset(initial)} />
    </form>
  );
}

export function NodePanel(props: PanelProps & { version: number }) {
  const { node, version } = props;
  // Remount on every new version so the form starts from the saved values.
  const key = `${node.id}-${version}`;
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">{STAGE_LABEL[node.type]}</h2>
      {node.type === "screening" ? <ScreeningPanel key={key} {...props} /> : null}
      {node.type === "quiz" ? <QuizPanel key={key} {...props} /> : null}
      {node.type === "interview" ? <InterviewPanel key={key} {...props} /> : null}
      {node.type === "final" ? <FinalPanel key={key} {...props} /> : null}
    </div>
  );
}
