export const qk = {
  me: () => ["me"] as const,
  org: () => ["org"] as const,
  myApplications: () => ["my-applications"] as const,
  jobs: () => ["jobs"] as const,
  job: (jobId: string) => ["jobs", jobId] as const,
  workflow: (jobId: string) => ["jobs", jobId, "workflow"] as const,
  workflowVersions: (jobId: string) => ["jobs", jobId, "workflow", "versions"] as const,
  jdChat: (threadId: string) => ["jd-chat", threadId] as const,
};
