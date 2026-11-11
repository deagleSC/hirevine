"use client";

import { ApiError, qk, unwrap, type components } from "@hirevine/api-client";
import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

export type CandidateFeedback = components["schemas"]["CandidateFeedback"];

/** Released feedback, or null while it is not available (the API returns 404 until release). */
export function useFeedback(appId: string) {
  return useQuery({
    queryKey: qk.myFeedback(appId),
    queryFn: () =>
      unwrap(api.GET("/v1/candidate/applications/{application_id}/feedback", { params: { path: { application_id: appId } } })).catch(
        (e: unknown) => {
          if (e instanceof ApiError && e.status === 404) return null;
          throw e;
        },
      ),
  });
}
