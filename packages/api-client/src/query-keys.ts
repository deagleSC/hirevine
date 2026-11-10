export const qk = {
  me: () => ["me"] as const,
  org: () => ["org"] as const,
  myApplications: () => ["my-applications"] as const,
  myApplication: (id: string) => ["my-applications", id] as const,
  publicJobs: (params: Record<string, string | undefined>) => ["public-jobs", params] as const,
  publicJob: (jobId: string) => ["public-jobs", "detail", jobId] as const,
  campaign: (id: string) => ["campaigns", id] as const,
  campaignApplications: (id: string, filters: Record<string, string | undefined>) =>
    ["campaigns", id, "applications", filters] as const,
  application: (campaignId: string, appId: string) => ["campaigns", campaignId, "applications", "detail", appId] as const,
  jobs: () => ["jobs"] as const,
  job: (jobId: string) => ["jobs", jobId] as const,
  workflow: (jobId: string) => ["jobs", jobId, "workflow"] as const,
  workflowVersions: (jobId: string) => ["jobs", jobId, "workflow", "versions"] as const,
  jdChat: (threadId: string) => ["jd-chat", threadId] as const,
};
