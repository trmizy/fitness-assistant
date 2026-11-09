/**
 * gb3-allowed-actions.test.ts
 * Tests for backend-driven allowedActions, allowedFor, party action helpers, and source guards.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTION_NAMES,
  PARTY_ACTION_NAMES,
  type DisputeCaseDetail,
  type PartyCaseDetail,
} from "../disputes/disputeCaseTypes";
import { allowedFor, isAllowed, refusalMessage, verdictOf } from "../disputes/actions/actionModel";
import { partyAllowed, partyAllowedFor, partyRefusal, partyVerdictOf } from "../../disputes/partyActions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("allowedFor helper (PART D.1)", () => {
  it("returns true only when the name is allowed and the id is in options", () => {
    const detail = {
      allowedActions: ["assignAppealReviewer", "createAppealObligation"],
      actions: {
        assignAppealReviewer: {
          allowed: true,
          options: ["item-1", "item-2"],
        },
      },
    } as unknown as DisputeCaseDetail;

    assert.equal(allowedFor(detail, "assignAppealReviewer", "item-1"), true);
    assert.equal(allowedFor(detail, "assignAppealReviewer", "item-2"), true);
  });

  it("returns false when the id is not in options", () => {
    const detail = {
      allowedActions: ["assignAppealReviewer"],
      actions: {
        assignAppealReviewer: {
          allowed: true,
          options: ["item-1"],
        },
      },
    } as unknown as DisputeCaseDetail;

    assert.equal(allowedFor(detail, "assignAppealReviewer", "item-999"), false);
  });

  it("returns false when allowedActions is missing (no server data)", () => {
    const detail = {
      actions: {
        assignAppealReviewer: {
          allowed: true,
          options: ["item-1"],
        },
      },
    } as unknown as DisputeCaseDetail;

    assert.equal(allowedFor(detail, "assignAppealReviewer", "item-1"), false);
  });

  it("returns false when options is missing or undefined", () => {
    const detail = {
      allowedActions: ["assignAppealReviewer"],
      actions: {
        assignAppealReviewer: {
          allowed: true,
        },
      },
    } as unknown as DisputeCaseDetail;

    assert.equal(allowedFor(detail, "assignAppealReviewer", "item-1"), false);
  });
});

describe("Party action helpers (PART D.2)", () => {
  it("partyAllowedFor returns true only when allowed and id is in options", () => {
    const detail = {
      allowedActions: ["confirmAgreement"],
      actions: {
        confirmAgreement: {
          allowed: true,
          options: ["agr-101", "agr-102"],
        },
      },
    } as unknown as PartyCaseDetail;

    assert.equal(partyAllowedFor(detail, "confirmAgreement", "agr-101"), true);
    assert.equal(partyAllowedFor(detail, "confirmAgreement", "agr-102"), true);
  });

  it("partyAllowedFor returns false when id is not in options", () => {
    const detail = {
      allowedActions: ["confirmAgreement"],
      actions: {
        confirmAgreement: {
          allowed: true,
          options: ["agr-101"],
        },
      },
    } as unknown as PartyCaseDetail;

    assert.equal(partyAllowedFor(detail, "confirmAgreement", "agr-999"), false);
  });

  it("partyAllowedFor returns false when allowedActions is missing", () => {
    const detail = {
      actions: {
        confirmAgreement: {
          allowed: true,
          options: ["agr-101"],
        },
      },
    } as unknown as PartyCaseDetail;

    assert.equal(partyAllowedFor(detail, "confirmAgreement", "agr-101"), false);
  });

  it("partyAllowedFor returns false when options is missing", () => {
    const detail = {
      allowedActions: ["confirmAgreement"],
      actions: {
        confirmAgreement: {
          allowed: true,
        },
      },
    } as unknown as PartyCaseDetail;

    assert.equal(partyAllowedFor(detail, "confirmAgreement", "agr-101"), false);
  });

  it("partyRefusal returns null for non-Vietnamese message", () => {
    const detailEnglish = {
      allowedActions: [],
      actions: {
        requestAppeal: {
          allowed: false,
          code: "APPEAL_WINDOW_CLOSED",
          message: "Appeal window has expired",
        },
      },
    } as unknown as PartyCaseDetail;

    assert.equal(partyRefusal(detailEnglish, "requestAppeal"), null);

    const detailVietnamese = {
      allowedActions: [],
      actions: {
        requestAppeal: {
          allowed: false,
          code: "APPEAL_WINDOW_CLOSED",
          message: "Đã hết thời hạn yêu cầu xem xét lại (14 ngày).",
        },
      },
    } as unknown as PartyCaseDetail;

    assert.equal(
      partyRefusal(detailVietnamese, "requestAppeal"),
      "Đã hết thời hạn yêu cầu xem xét lại (14 ngày)."
    );
  });
});

describe("Source guards CODE AUDIT style (PART D.3)", () => {
  const forbiddenTokens = [
    "canProposeAgreement",
    "canWithdrawAgreement",
    "canRecordAgreementFinding",
    "canRetryObligation",
    "canProposeReplacement",
    "canDecideReplacement",
    "canRequestPartyAppeal",
    "appealsCapability",
    "replacementEnabled",
    "proposedBy !== currentUserId",
  ];

  const targetFiles = [
    path.resolve(__dirname, "../disputes/actions/AgreementPanel.tsx"),
    path.resolve(__dirname, "../disputes/workspace/tabs/AppealTab.tsx"),
    path.resolve(__dirname, "../disputes/actions/QuotaCorrectionCard.tsx"),
    path.resolve(__dirname, "../disputes/actions/ReplacementPanel.tsx"),
    path.resolve(__dirname, "../../disputes/PartyAgreementPanel.tsx"),
    path.resolve(__dirname, "../../disputes/DisputeCasePartyPage.tsx"),
  ];

  for (const filePath of targetFiles) {
    const baseName = path.basename(filePath);
    it(`${baseName} contains none of the forbidden local rule tokens`, () => {
      assert.ok(fs.existsSync(filePath), `File must exist: ${filePath}`);
      const content = fs.readFileSync(filePath, "utf-8");
      for (const token of forbiddenTokens) {
        assert.equal(
          content.includes(token),
          false,
          `File ${baseName} must not contain "${token}"`
        );
      }
    });
  }
});

describe("Action names catalog (PART D.4)", () => {
  it("ACTION_NAMES contains the 15 new V2.1 action names", () => {
    const expected15 = [
      "proposeAgreement",
      "withdrawAgreement",
      "recordAgreementFinding",
      "assignAppealReviewer",
      "decideAppeal",
      "createAppealObligation",
      "syncAppealObligation",
      "proposeQuotaCorrection",
      "approveQuotaCorrection",
      "proposeDecisionReplacement",
      "approveDecisionReplacement",
      "rejectDecisionReplacement",
      "decideHeldMoney",
      "proposeContractPolicy",
      "approveContractPolicy",
    ] as const;

    for (const name of expected15) {
      assert.ok(
        (ACTION_NAMES as readonly string[]).includes(name),
        `ACTION_NAMES must include "${name}"`
      );
    }
  });

  it("PARTY_ACTION_NAMES equals the 5 party names", () => {
    const expected5 = [
      "addStatement",
      "addEvidence",
      "addEvidenceFile",
      "confirmAgreement",
      "requestAppeal",
    ];

    assert.deepEqual(Array.from(PARTY_ACTION_NAMES), expected5);
  });
});

