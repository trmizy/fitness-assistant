/**
 * Wallet-history labels - pure view-model, node:test like the sibling tests.
 * Run: npx tsx --test src/app/utils/__tests__/walletEntryLabel.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { walletEntryLabel, WALLET_ENTRY_LABEL } from "../walletEntryLabel";

const ID = "97aa71d5-3388-4e8b-8740-887f852b6435";

describe("walletEntryLabel", () => {
  it("names a late-payment auto-refund by what was bought, never by its ledger text", () => {
    assert.equal(
      walletEntryLabel({ category: "REFUND_UNACTIVATED_PERSONALIZED_SERVICE", entryType: "CREDIT", description: `PERSONALIZED_SERVICE_PURCHASE ${ID} — refund (contract could not be activated)` }),
      "Hoàn tiền dịch vụ cá nhân hóa (đơn đã hủy trước khi thanh toán xong)",
    );
    assert.equal(
      walletEntryLabel({ category: "REFUND_UNACTIVATED_MEMBERSHIP", entryType: "CREDIT", description: `GYM_MEMBERSHIP ${ID} — refund (contract could not be activated)` }),
      "Hoàn tiền gói hội viên (gói đã hủy trước khi thanh toán xong)",
    );
  });

  it("PT refunds and compensation", () => {
    assert.equal(walletEntryLabel({ category: "REFUND_PT_CONTRACT", entryType: "CREDIT" }), "Hoàn tiền hợp đồng PT");
    assert.equal(walletEntryLabel({ category: "COMPENSATION_PT_NO_SHOW", entryType: "CREDIT" }), "Hoàn tiền buổi PT vắng");
    assert.equal(walletEntryLabel({ category: "COMPENSATION_PT_LATE_ARRIVAL", entryType: "CREDIT" }), "Bồi thường PT đến muộn");
  });

  it("every label is plain Vietnamese: no uuid, no UPPER_SNAKE enum, no English ledger words", () => {
    for (const [code, label] of Object.entries(WALLET_ENTRY_LABEL)) {
      assert.doesNotMatch(label, /[0-9a-f]{8}-[0-9a-f]{4}-/i, code);
      assert.doesNotMatch(label, /[A-Z]{3,}_[A-Z]/, code);
      assert.doesNotMatch(label, /\b(refund|contract|compensation|pending|ledger)\b/i, code);
    }
  });

  it("an unknown or missing category is labelled by direction only", () => {
    assert.equal(walletEntryLabel({ category: "SOMETHING_NEW", entryType: "CREDIT", description: `X ${ID}` }), "Tiền vào ví");
    assert.equal(walletEntryLabel({ category: "SOMETHING_NEW", entryType: "DEBIT" }), "Tiền ra khỏi ví");
    assert.equal(walletEntryLabel({ entryType: "DEBIT" }), "Tiền ra khỏi ví");
  });

  it("a backend that predates `category`: the description is read product-first, never leaked", () => {
    const old = (description: string, entryType = "CREDIT") => walletEntryLabel({ description, entryType });
    assert.equal(old(`PERSONALIZED_SERVICE_PURCHASE ${ID} — refund (contract could not be activated)`), WALLET_ENTRY_LABEL.REFUND_UNACTIVATED_PERSONALIZED_SERVICE);
    assert.equal(old(`GYM_MEMBERSHIP ${ID} — refund (contract could not be activated)`), WALLET_ENTRY_LABEL.REFUND_UNACTIVATED_MEMBERSHIP);
    assert.equal(old(`Contract ${ID} termination — refund (CLIENT_CANCELLED)`), "Hoàn tiền hợp đồng PT");
    assert.equal(old(`Membership ${ID} client self-cancel — refund`), "Hoàn tiền gói hội viên");
    assert.equal(old(`Contract ${ID} no-show ${ID} — compensation for a missed session`), "Hoàn tiền buổi PT vắng");
    assert.equal(old(`Session ${ID} SETTLED_X`, "DEBIT"), "Tiền ra khỏi ví");
  });
});
