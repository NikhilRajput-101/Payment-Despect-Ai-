
const db = require("./db");

/**
 * AI Integrity Guard
 * Validates AI-generated dispute recommendations against local records.
 * This does NOT independently authenticate carrier tracking information.
 */

function verifyAiDraft({ disputeId, draftText = "", strategy = "REVIEW" }) {
  const violations = [];
  const checks = [];

  const dispute = db.prepare(
    "SELECT * FROM disputes WHERE dispute_id = ?"
  ).get(disputeId);

  // 1. Verify dispute exists
  if (!dispute) {
    return {
      verdict: "BLOCKED",
      violations: ["Dispute record not found."],
      checks: [{ name: "Dispute existence", passed: false }]
    };
  }

  checks.push({
    name: "Dispute existence",
    passed: true
  });

  // 2. Verify associated order
  const order = db.prepare(
    "SELECT * FROM orders WHERE capture_id = ?"
  ).get(dispute.capture_id);

  if (!order) {
    violations.push("No matching order found for this dispute.");
  }

  checks.push({
    name: "Order verification",
    passed: Boolean(order)
  });

  // 3. Verify shipping information
  const shipping = order
    ? db.prepare(
        "SELECT * FROM shipping_records WHERE order_id = ?"
      ).get(order.order_id)
    : null;

  if (strategy === "FIGHT") {
    if (!shipping) {
      violations.push(
        "Cannot recommend FIGHT: shipping evidence is missing."
      );
    } else {
      // Check tracking number
      if (
        !draftText.includes(shipping.tracking_number)
      ) {
        violations.push(
          "Draft does not contain the recorded tracking number."
        );
      }

      checks.push({
        name: "Tracking number consistency",
        passed: draftText.includes(shipping.tracking_number)
      });

      // Check carrier
      const carrierPresent = draftText
        .toLowerCase()
        .includes(shipping.carrier.toLowerCase());

      if (!carrierPresent) {
        violations.push(
          "Draft does not reference the recorded shipping carrier."
        );
      }

      checks.push({
        name: "Carrier consistency",
        passed: carrierPresent
      });

      // Check delivery claims
      const claimsDelivery =
        /\b(delivered|delivery confirmed|successfully delivered)\b/i
          .test(draftText);

      if (
        claimsDelivery &&
        shipping.delivery_status !== "DELIVERED"
      ) {
        violations.push(
          "Draft claims delivery, but the database does not show DELIVERED."
        );
      }

      checks.push({
        name: "Delivery status consistency",
        passed:
          !claimsDelivery ||
          shipping.delivery_status === "DELIVERED"
      });

      // Check signature claims
      const claimsSignature =
        /\b(signed|signature confirmed|proof of signature)\b/i
          .test(draftText);

      if (claimsSignature && !shipping.signature_present) {
        violations.push(
          "Draft claims signature confirmation, but no signature is recorded."
        );
      }

      checks.push({
        name: "Signature consistency",
        passed:
          !claimsSignature ||
          Boolean(shipping.signature_present)
      });
    }
  }

  // 4. Validate strategy
  if (!["FIGHT", "ACCEPT"].includes(strategy)) {
    violations.push(
      "Invalid or non-executable strategy. Manual review is required."
    );
  }

  checks.push({
    name: "Strategy validation",
    passed: ["FIGHT", "ACCEPT"].includes(strategy)
  });

  // 5. Validate draft
  if (strategy === "FIGHT" && !draftText.trim()) {
    violations.push("Defense draft is empty.");
  }

  checks.push({
    name: "Draft validation",
    passed: strategy !== "FIGHT" || Boolean(draftText.trim())
  });

  // 6. Final verdict
  const verdict =
    violations.length === 0 ? "PASSED" : "BLOCKED";

  // 7. Audit logging
  db.prepare(`
    INSERT INTO audit_log (actor, action, details)
    VALUES (?, ?, ?)
  `).run(
    "INTEGRITY_CHECK",
    verdict === "PASSED"
      ? "INTEGRITY_PASSED"
      : "INTEGRITY_BLOCKED",
    JSON.stringify({
      disputeId,
      strategy,
      verdict,
      violations,
      checks
    })
  );

  return {
    verdict,
    violations,
    checks
  };
}

module.exports = { verifyAiDraft };
