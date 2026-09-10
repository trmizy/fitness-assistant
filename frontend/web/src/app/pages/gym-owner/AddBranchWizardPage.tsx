import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleNotchIcon } from "@phosphor-icons/react";
import { gymService } from "../../services/api";
import type { Gym, GymBrand, GymFacility, GymOperatingHoursDay, GymBranchReviewIssue } from "../../types";
import { WizardShell, WIZARD_STEP_LABELS, type SaveStatus } from "../../components/gym/AddBranchWizard/WizardShell";
import { StepBasicInfo, validateBasicInfo, type BasicInfoValue } from "../../components/gym/AddBranchWizard/StepBasicInfo";
import { StepLocation, validateLocation, type LocationValue } from "../../components/gym/AddBranchWizard/StepLocation";
import { StepOpeningHours, validateOpeningHours } from "../../components/gym/AddBranchWizard/StepOpeningHours";
import { StepFacilities } from "../../components/gym/AddBranchWizard/StepFacilities";
import { StepPhotos } from "../../components/gym/AddBranchWizard/StepPhotos";
import { StepVerification } from "../../components/gym/AddBranchWizard/StepVerification";
import { StepReviewSubmit, type SubmitIssue } from "../../components/gym/AddBranchWizard/StepReviewSubmit";
import { ErrorState } from "../../components/ui/ErrorState";

const TOTAL_STEPS = WIZARD_STEP_LABELS.length;
const SAVE_DEBOUNCE_MS = 700;

const ALL_WEEK_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
function defaultHours(gymId: string): GymOperatingHoursDay[] {
  return ALL_WEEK_DAYS.map((day) => ({ id: null, gymId, day, type: "CLOSED", openMinute: null, closeMinute: null }));
}

/**
 * GYM_BRANCH_FORM_SPEC.md — all 7 steps now have real content (Phase 2 built 1-3, Phase 3
 * built 4-6, Phase 4 built 7 + submission). Draft creation, resume-at-furthest-step, and the
 * auto-save indicator are all Phase 1 work, unchanged here. Steps 5-6 (StepPhotos/
 * StepVerification) are self-contained — they own their own query/mutations against `gymId`
 * rather than a value handed down from here, since a photo grid or a per-document-type
 * upload doesn't fit the single-debounced-form-value shape steps 1/2/4 use.
 *
 * Phase 4 — the "fix loop": if admin sent this branch back from PENDING_REVIEW with
 * category-flagged issues (gymBranchReviewService.requestChanges on the backend), a banner
 * shows on every step (jumping to Step 7 for the full list) and Step 7 itself lists them
 * with per-category links back to the relevant step. Resolving happens implicitly — a
 * successful resubmit closes every open issue at once (see gymDraftService.submitForReview's
 * own doc comment for why this is simpler and more correct than per-field auto-resolution).
 *
 * Deliberately NOT wired into the primary "New Gym" button yet — the existing dialog in
 * MyGymsPage.tsx stays the real, working creation path until enough of this wizard's real
 * step content exists to fully replace it (tracked in GYM_BRANCH_FORM_PARITY.md, written
 * once that cutover happens). Reachable today via the "Continue Setup" affordance on a
 * resumed draft, and directly by URL for verification.
 */
export function AddBranchWizardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [stepIssues, setStepIssues] = useState<string[]>([]);
  const hasLoadedInitialStep = useRef(false);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 1/2 local form state (undefined until the draft has loaded once).
  const [basicInfo, setBasicInfo] = useState<BasicInfoValue | null>(null);
  const [location, setLocation] = useState<LocationValue | null>(null);
  const [hours, setHours] = useState<GymOperatingHoursDay[] | null>(null);
  const [facilities, setFacilities] = useState<GymFacility[] | null>(null);
  const [submitIssues, setSubmitIssues] = useState<SubmitIssue[]>([]);

  // No :id yet — create a draft once, then own the URL so a refresh resumes correctly
  // instead of minting a second draft.
  const createMutation = useMutation({
    mutationFn: () => gymService.createGymDraft(),
    onSuccess: (draft: Gym) => navigate(`/gym-owner/gyms/wizard/${draft.id}`, { replace: true }),
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể tạo chi nhánh"),
  });
  useEffect(() => {
    if (!id && !createMutation.isPending && !createMutation.isSuccess) createMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const draftQuery = useQuery<Gym>({
    queryKey: ["owned-gym-draft", id],
    queryFn: () => gymService.getOwnedGym(id!),
    enabled: !!id,
  });

  const hoursQuery = useQuery<GymOperatingHoursDay[]>({
    queryKey: ["owned-gym-draft-hours", id],
    queryFn: () => gymService.getGymHours(id!),
    enabled: !!id,
  });

  const brandsQuery = useQuery<GymBrand[]>({ queryKey: ["owned-brands"], queryFn: () => gymService.listOwnedBrands() });
  const brandName = brandsQuery.data?.[0] ? (brandsQuery.data[0].approvedName ?? brandsQuery.data[0].name) : "…";

  // GYM_BRANCH_FORM_SPEC.md, Phase 4 — the "fix loop": what admin flagged last time this
  // branch was sent back from PENDING_REVIEW to DRAFT, if ever.
  const reviewIssuesQuery = useQuery<GymBranchReviewIssue[]>({
    queryKey: ["owned-gym-review-issues", id],
    queryFn: () => gymService.listOpenReviewIssues(id!),
    enabled: !!id,
  });
  const openReviewIssues = reviewIssuesQuery.data ?? [];

  // Resume at the saved step exactly once, when the draft first loads, and seed local form
  // state from the server's current values.
  useEffect(() => {
    if (draftQuery.data && !hasLoadedInitialStep.current) {
      hasLoadedInitialStep.current = true;
      setStep(draftQuery.data.wizardStep ?? 1);
      setBasicInfo({
        name: draftQuery.data.name ?? "",
        description: draftQuery.data.description ?? "",
        phone: draftQuery.data.phone ?? "",
        email: draftQuery.data.email ?? "",
      });
      setLocation({
        address: draftQuery.data.address ?? "",
        provinceCode: draftQuery.data.provinceCode ?? null,
        wardCode: draftQuery.data.wardCode ?? null,
        latitude: draftQuery.data.latitude ?? null,
        longitude: draftQuery.data.longitude ?? null,
        locationNote: draftQuery.data.locationNote ?? "",
      });
      setFacilities(draftQuery.data.facilities ?? []);
    }
  }, [draftQuery.data]);

  useEffect(() => {
    if (hoursQuery.data && !hours) setHours(hoursQuery.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoursQuery.data]);

  const saveDraftMutation = useMutation({
    mutationFn: (payload: Parameters<typeof gymService.updateGymDraft>[1]) => gymService.updateGymDraft(id!, payload),
    onMutate: () => setSaveStatus("saving"),
    onSuccess: () => {
      setSaveStatus("saved");
      setSavedAt(new Date());
      // §9/§10 — draft.wizardStep (the server's monotonic high-water mark) must stay fresh
      // after every save, wizardStep-only or not: furthestStep below reads it directly, and a
      // stale cached value here would re-lock rail steps the owner already unlocked the
      // moment they navigate back to review an earlier one (the exact regression found and
      // fixed on the backend in Phase 1 — same bug, this time on the client's own cache).
      queryClient.invalidateQueries({ queryKey: ["owned-gym-draft", id] });
      queryClient.invalidateQueries({ queryKey: ["owned-gyms"] });
    },
    onError: () => setSaveStatus("error"),
  });

  const submitMutation = useMutation({
    mutationFn: () => gymService.submitGymDraft(id!),
    onSuccess: () => {
      toast.success("Đã gửi chi nhánh cho Gymini duyệt");
      queryClient.invalidateQueries({ queryKey: ["owned-gyms"] });
      navigate(`/gym-owner/gyms/${id}`, { replace: true });
    },
    onError: (e: any) => {
      const issues = e?.response?.data?.error?.issues;
      setSubmitIssues(Array.isArray(issues) ? issues : []);
      toast.error(e?.response?.data?.error?.message || "Không thể gửi duyệt");
    },
  });

  const saveHoursMutation = useMutation({
    mutationFn: (days: GymOperatingHoursDay[]) => gymService.setGymHours(id!, days),
    onMutate: () => setSaveStatus("saving"),
    onSuccess: (saved) => {
      setSaveStatus("saved");
      setSavedAt(new Date());
      setHours(saved);
    },
    onError: () => setSaveStatus("error"),
  });

  // Debounced auto-save for free-typing fields (name/description/phone/email/address/...) —
  // §8: "Saving…/Saved", not a save-on-every-keystroke request storm.
  function scheduleDraftSave(payload: Parameters<typeof gymService.updateGymDraft>[1]) {
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => saveDraftMutation.mutate(payload), SAVE_DEBOUNCE_MS);
  }

  function goToStep(next: number) {
    const clamped = Math.max(1, Math.min(TOTAL_STEPS, next));
    setStep(clamped);
    setStepIssues([]);
    setSubmitIssues([]);
    saveDraftMutation.mutate({ wizardStep: clamped });
  }

  // §59 — validate the CURRENT step only, inline; block "Continue" until it passes, but
  // clicking an already-unlocked rail item to go back never gets blocked by this.
  function handleContinue() {
    if (step === 1 && basicInfo) {
      const issues = validateBasicInfo(basicInfo);
      if (issues.length > 0) return setStepIssues(issues);
    }
    if (step === 2 && location) {
      const issues = validateLocation(location);
      if (issues.length > 0) return setStepIssues(issues);
    }
    if (step === 3 && hours) {
      const issues = validateOpeningHours(hours);
      if (issues.length > 0) return setStepIssues(issues);
    }
    goToStep(step + 1);
  }

  if (createMutation.isPending || (id && (draftQuery.isLoading || hoursQuery.isLoading))) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <CircleNotchIcon className="size-6 text-green-500 animate-spin" />
      </div>
    );
  }

  if (draftQuery.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <ErrorState kind="not-found" message="Không thể tải hồ sơ chi nhánh." onRetry={() => draftQuery.refetch()} />
      </div>
    );
  }

  const draft = draftQuery.data;
  if (!draft) return null;

  // A draft that's already been submitted (e.g. the owner navigated back here with a stale
  // URL) — send them to the real branch page instead of showing a dead wizard.
  if (draft.status !== "DRAFT") {
    navigate(`/gym-owner/gyms/${draft.id}`, { replace: true });
    return null;
  }

  return (
    <WizardShell
      brandName={brandName}
      currentStep={step}
      furthestStep={Math.max(step, draft.wizardStep ?? 1)}
      onStepSelect={goToStep}
      saveStatus={saveStatus}
      savedAt={savedAt}
      onBack={step > 1 ? () => goToStep(step - 1) : undefined}
      // Step 7 has its own dedicated "Gửi duyệt" submit button inside StepReviewSubmit —
      // the generic nav "Continue" button would be a confusing second, redundant action
      // there (and "Continue" past the last step has nowhere left to go anyway).
      onContinue={step === TOTAL_STEPS ? undefined : handleContinue}
      continueLabel="Tiếp tục"
    >
      {openReviewIssues.length > 0 && step !== TOTAL_STEPS && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 flex items-center justify-between gap-3">
          <p className="text-xs text-amber-400">
            Admin đã yêu cầu chỉnh sửa {openReviewIssues.length} mục trước khi duyệt.
          </p>
          <button type="button" onClick={() => goToStep(TOTAL_STEPS)} className="shrink-0 text-xs font-semibold text-amber-300 underline">
            Xem chi tiết
          </button>
        </div>
      )}

      {stepIssues.length > 0 && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
          <p className="text-xs font-semibold text-red-400 mb-1">Cần hoàn tất trước khi tiếp tục:</p>
          <ul className="list-disc list-inside space-y-0.5">
            {stepIssues.map((issue) => (
              <li key={issue} className="text-xs text-red-400/90">
                {issue}
              </li>
            ))}
          </ul>
        </div>
      )}

      {step === 1 && basicInfo && (
        <StepBasicInfo
          brandName={brandName}
          value={basicInfo}
          onChange={(next) => {
            setBasicInfo(next);
            setStepIssues([]);
            scheduleDraftSave(next);
          }}
        />
      )}

      {step === 2 && location && (
        <StepLocation
          value={location}
          onChange={(next) => {
            setLocation(next);
            setStepIssues([]);
            scheduleDraftSave(next);
          }}
        />
      )}

      {step === 3 && (
        <StepOpeningHours
          value={hours ?? defaultHours(draft.id)}
          onChange={(next) => {
            setHours(next);
            setStepIssues([]);
            saveHoursMutation.mutate(next);
          }}
        />
      )}

      {step === 4 && facilities && (
        <StepFacilities
          value={facilities}
          onChange={(next) => {
            setFacilities(next);
            scheduleDraftSave({ facilities: next });
          }}
        />
      )}

      {step === 5 && <StepPhotos gymId={draft.id} />}

      {step === 6 && <StepVerification gymId={draft.id} />}

      {step === 7 && basicInfo && location && (
        <StepReviewSubmit
          gymId={draft.id}
          brandName={brandName}
          basicInfo={basicInfo}
          location={location}
          hours={hours ?? defaultHours(draft.id)}
          facilities={facilities ?? []}
          openReviewIssues={openReviewIssues}
          submitIssues={submitIssues}
          submitting={submitMutation.isPending}
          onSubmit={() => {
            setSubmitIssues([]);
            submitMutation.mutate();
          }}
          onGoToStep={goToStep}
        />
      )}
    </WizardShell>
  );
}

export default AddBranchWizardPage;
