"use client";

import {
  ApiError,
  checkResumeFile,
  messageFor,
  qk,
  resumeContentType,
  unwrap,
  uploadToSignedUrl,
} from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";
import { Alert, AlertDescription, AlertTitle } from "@hirevine/ui/components/alert";
import { Button } from "@hirevine/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@hirevine/ui/components/card";
import { Checkbox } from "@hirevine/ui/components/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@hirevine/ui/components/field";
import { Spinner } from "@hirevine/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, FileCheck2, FileUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { useConsentInfo, usePublicJob } from "@/lib/jobs";

type Uploaded = { path: string; name: string };

function UploadStep({ jobId, onUploaded }: { jobId: string; onUploaded: (u: Uploaded) => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const invalid = checkResumeFile(file);
    if (invalid) return setProblem(invalid);
    setProblem(null);
    setProgress(0);
    abort.current = new AbortController();
    const contentType = resumeContentType(file);
    try {
      const signed = await unwrap(
        api.POST("/v1/candidate/applications/upload-url", {
          body: { job_id: jobId, filename: file.name, content_type: contentType, size: file.size },
        }),
      );
      await uploadToSignedUrl(signed.upload_url, file, contentType, setProgress, abort.current.signal);
      onUploaded({ path: signed.resume_path, name: file.name });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setProblem(err instanceof ApiError ? err.message : err instanceof Error ? err.message : messageFor(err));
    } finally {
      setProgress(null);
    }
  }

  const uploading = progress !== null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">1. Your resume</CardTitle>
        <CardDescription>PDF or Word (.docx), up to 5 MB. It goes straight to private storage.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {problem ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Couldn&apos;t use that file</AlertTitle>
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        ) : null}
        {uploading ? (
          <div className="grid gap-1" role="status" aria-live="polite">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">Uploading… {Math.round(progress * 100)}%</p>
          </div>
        ) : (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center hover:bg-accent/50 focus-within:ring-2 focus-within:ring-ring">
            <FileUp className="size-6 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">Choose a file</span>
            <input
              type="file"
              className="sr-only"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={onPick}
            />
          </label>
        )}
      </CardContent>
    </Card>
  );
}

export default function ApplyPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const job = usePublicJob(jobId);
  const consent = useConsentInfo();
  const [resume, setResume] = useState<Uploaded | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [adult, setAdult] = useState(false);

  const submit = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/v1/candidate/applications", {
          body: {
            job_id: jobId,
            resume_path: resume!.path,
            consent: { text_version: consent.data!.text_version },
            adult_confirmed: adult,
          },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.myApplications() });
      toast.success("Application received", { description: "We'll show the next step here as soon as it's ready." });
      router.push("/applications");
    },
  });

  if (job.isError) return <ErrorState title="Role not available" message={messageFor(job.error)} />;
  if (consent.isError) return <ErrorState message={messageFor(consent.error)} />;
  if (job.isPending || consent.isPending) return <PageSkeleton />;

  const error = submit.error instanceof ApiError ? submit.error : null;
  return (
    <>
      <PageHeader title={`Apply: ${job.data.title}`} description={[job.data.seniority, job.data.location].filter(Boolean).join(" · ")} />
      <div className="grid max-w-2xl gap-4">
        {resume ? (
          <Alert>
            <FileCheck2 />
            <AlertTitle>Resume uploaded</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              {resume.name}
              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setResume(null)}>
                Replace
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <UploadStep jobId={jobId} onUploaded={setResume} />
        )}

        <Card aria-disabled={!resume} className={resume ? undefined : "opacity-60"}>
          <CardHeader>
            <CardTitle className="text-base">2. How your application is assessed</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <ul className="grid list-disc gap-1.5 pl-5 text-muted-foreground">
              <li>Your resume is scored against the role&apos;s published criteria. An AI assists and must quote the resume line behind each score.</li>
              <li>Your name, contact details, address, date of birth and similar personal details are removed before any AI model sees the text.</li>
              <li>A person on the hiring team makes every decision. You will not see scores or rankings until results are released.</li>
              <li>
                Your data is handled by these processors: {consent.data.providers.join(", ")}.{" "}
                <Link href="/ai-evaluation" className="underline">Learn more</Link>
              </li>
            </ul>
            <FieldGroup className="gap-3">
              <Field orientation="horizontal">
                <Checkbox id="consent" checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} disabled={!resume} />
                <FieldLabel htmlFor="consent" className="font-normal">
                  I agree to my application being assessed as described above.
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Checkbox id="adult" checked={adult} onCheckedChange={(v) => setAdult(v === true)} disabled={!resume} />
                <FieldLabel htmlFor="adult" className="font-normal">I confirm I am 18 or older.</FieldLabel>
              </Field>
              <FieldDescription>Consent version {consent.data.text_version}.</FieldDescription>
            </FieldGroup>
            {error ? (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>Couldn&apos;t submit</AlertTitle>
                <AlertDescription>
                  {error.message}
                  {error.code === "already_applied" ? (
                    <Link href="/applications" className="ml-1 underline">See your applications</Link>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : submit.error ? (
              <ErrorState message={messageFor(submit.error)} />
            ) : null}
          </CardContent>
          <CardFooter>
            <Button disabled={!resume || !agreed || !adult || submit.isPending} onClick={() => submit.mutate()}>
              {submit.isPending ? <Spinner /> : null}
              Submit application
            </Button>
          </CardFooter>
        </Card>
      </div>
    </>
  );
}
