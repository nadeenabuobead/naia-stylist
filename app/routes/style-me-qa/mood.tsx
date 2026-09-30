// app/routes/style-me-qa/mood.tsx
// QA front-door wrapper. Re-exports the real /style-me/mood module verbatim; only
// paths are re-prefixed so the flow stays inside /style-me-qa. No recommendation
// logic lives here. See app/lib/styleme/qa-prefix.tsx.
// Delete this file with the rest of the QA harness when QA is finished.

import {
  loader as realLoader,
  action as realAction,
} from "~/routes/style-me/mood";
import { wrapLoader, wrapAction } from "~/lib/styleme/qa-prefix";

export const loader = wrapLoader(realLoader);
export const action = wrapAction(realAction);
