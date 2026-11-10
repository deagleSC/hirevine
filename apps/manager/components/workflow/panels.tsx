"use client";

import {
  CriterionSchema,

  RubricItemSchema,
  diffFormToPatches,
  formFromNode,
  type NodeForm,
  type Patch,
  type Workflow,
  type WorkflowNode,
} from "@hirevine/api-client";
import { Button } from "@hirevine/ui/components/button";
import { Checkbox } from "@hirevine/ui/components/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@hirevine/ui/components/field";
import { Input } from "@hirevine/ui/components/input";
import { RadioGroup, RadioGroupItem } from "@hirevine/ui/components/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hirevine/ui/components/select";
import { Slider } from "@hirevine/ui/components/slider";
import { Switch } from "@hirevine/ui/components/switch";
import { Textarea } from "@hirevine/ui/components/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { Controller, useFieldArray, useForm, type Control, type FieldValues, type UseFormRegister } from "react-hook-form";
import { z } from "zod";

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
  base: Workflow;
  node: WorkflowNode;
  onPropose: (patches: Patch[]) => void;
  busy: boolean;
  readOnly?: boolean;
}

function Footer({ busy, readOnly, onReset, dirty }: { busy: boolean; readOnly?: boolean; onReset: () => void; dirty: boolean }) {
  if (readOnly) return null;
  return (
    <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background pt-3">
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
function QuestionEditor({ form, index, onRemove }: { form: ReturnType<typeof useForm<z.infer<typeof quizSchema>>>; index: number; onRemove: () => void }) {
  const options = form.watch(`questions.${index}.options`);
  const errs = form.formState.errors.questions?.[index];
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <Textarea aria-label={`Question ${index + 1}`} rows={2} {...form.register(`questions.${index}.prompt`)} />
        <Button type="button" variant="ghost" size="icon" aria-label={`Remove question ${index + 1}`} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
      {errs?.prompt ? <FieldError>{errs.prompt.message}</FieldError> : null}
      <Controller
        control={form.control}
        name={`questions.${index}.answer_index`}
        render={({ field }) => (
          <RadioGroup value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))} aria-label="Correct option">
            {options.map((_, oi) => (
              <div key={oi} className="flex items-center gap-2">
                <RadioGroupItem value={String(oi)} aria-label={`Option ${oi + 1} is correct`} />
                <Input aria-label={`Option ${oi + 1}`} {...form.register(`questions.${index}.options.${oi}`)} />
                {options.length > 3 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove option ${oi + 1}`}
                    onClick={() => {
                      const next = options.filter((__, j) => j !== oi);
                      form.setValue(`questions.${index}.options`, next, { shouldDirty: true });
                      if (field.value >= next.length) field.onChange(0);
                    }}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
            ))}
          </RadioGroup>
        )}
      />
      {options.length < 5 ? (
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => form.setValue(`questions.${index}.options`, [...options, ""], { shouldDirty: true })}>
          <Plus /> Add option
        </Button>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
        <Input aria-label="Explanation" placeholder="Why the answer is correct (optional)" {...form.register(`questions.${index}.explanation`)} />
        <Controller
          control={form.control}
          name={`questions.${index}.difficulty`}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger aria-label="Difficulty">
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
      </div>
    </div>
  );
}

function QuizPanel({ base, node, onPropose, busy, readOnly }: PanelProps) {
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
          <FieldDescription>Question generation from the job description arrives with the quiz feature.</FieldDescription>
          {qs.fields.map((q, i) => (
            <QuestionEditor key={q.id} form={form} index={i} onRemove={() => qs.remove(i)} />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
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
