import "server-only";

import {
  claimNextWorkflowAction,
  createWorkflowWorkerId,
  executeWorkflowAction,
  markWorkflowActionFailed,
  markWorkflowActionSucceeded,
} from "@/lib/workflows/repository";

export type WorkflowWorkerResult = Readonly<{
  claimed: number;
  failed: number;
  processed: number;
}>;

export async function processWorkflowBatch(requestedLimit = 20): Promise<WorkflowWorkerResult> {
  const result = { claimed: 0, failed: 0, processed: 0 };
  const limit = Math.max(1, Math.min(50, Math.trunc(requestedLimit)));
  const workerId = createWorkflowWorkerId();

  for (let index = 0; index < limit; index += 1) {
    const action = await claimNextWorkflowAction(workerId);
    if (!action) break;
    result.claimed += 1;
    try {
      const evidence = await executeWorkflowAction(action);
      const recorded = await markWorkflowActionSucceeded(action, workerId, evidence);
      if (!recorded) throw new Error("Workflow action lease was lost before completion.");
      result.processed += 1;
    } catch (error) {
      await markWorkflowActionFailed(action, workerId, error);
      result.failed += 1;
    }
  }
  return result;
}
