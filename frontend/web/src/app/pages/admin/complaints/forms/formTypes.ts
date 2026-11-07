import type { PushNote } from "../gymCaseKit";
import type { Reload } from "../../disputes/actions/actionKit";
import type { GymCaseDetail } from "../gymCaseTypes";

/** What every write form of the case workspace receives. */
export interface FormProps {
  detail: GymCaseDetail;
  currentUserId: string;
  /** re-read G3 (and the list); resolves when done */
  onChanged: Reload;
  /** results that must outlive the form that produced them */
  push: PushNote;
}
