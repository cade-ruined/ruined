import "server-only";

import { cache } from "react";
import { getOperatorRole as readOperatorRole } from "./repository";

// Page chrome and page access share one role read. Repositories still reauthorize
// the actual resource, and mutations retain their fresh, locked permission checks.
export const getOperatorRole = cache(readOperatorRole);
