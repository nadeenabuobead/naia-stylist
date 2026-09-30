// app/routes/style-me-qa/state.tsx
// QA front-door wrapper. Re-exports the real /style-me/state module verbatim; only
// paths are re-prefixed so the flow stays inside /style-me-qa. No recommendation
// logic lives here. See app/lib/styleme/qa-prefix.tsx.
// Delete this file with the rest of the QA harness when QA is finished.

import {
  loader as realLoader,
  action as realAction,
  default as RealComponent,
  links,
} from "~/routes/style-me/state";
import { wrapLoader, wrapAction, QaNav } from "~/lib/styleme/qa-prefix";

export { links };
export const loader = wrapLoader(realLoader);
export const action = wrapAction(realAction);

export default function QaState() {
  return (
    <QaNav>
      <RealComponent />
    </QaNav>
  );
}
