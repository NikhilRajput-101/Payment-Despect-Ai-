// const db = require("./db");
// const { getDisputeDetails } = require("./paypalDisputes");

// async function verifyGateWithDisputeId() {
//   console.log("--- STARTING OCT 27 GATE CHECK ---");

//   const realDisputeId = "PP-R-KMF-10194774";
//   const testCaptureId = "9MK565231W739591N";
//   const testOrderId = "ORD-TEST-001";

//   try {
//     // 1. Seed Order and Shipping details in DB
//     db.prepare(`
//       INSERT OR REPLACE INTO orders (order_id, capture_id, product_name, amount, buyer_email)
//       VALUES (?, ?, ?, ?, ?)
//     `).run(testOrderId, testCaptureId, "Mechanical Keyboard", 5.00, "buyer@personal.example.com");

//     db.prepare(`
//       INSERT OR REPLACE INTO shipping_records (order_id, carrier, tracking_number, shipped_at, delivered_at, delivery_status, signature_present)
//       VALUES (?, ?, ?, ?, ?, ?, ?)
//     `).run(
//       testOrderId,
//       "FEDEX",
//       "TRACK-FDX-998811",
//       "2026-10-20 09:00:00",
//       "2026-10-22 15:45:00",
//       "DELIVERED",
//       1
//     );

//     console.log("Step 1: Database Seeded.");

//     // 2. Fetch real dispute details directly from PayPal REST API
//     console.log(`Step 2: Fetching dispute details for ID: ${realDisputeId}...`);
//     const details = await getDisputeDetails(realDisputeId);

//     console.log("PayPal Response Status:", details.status);
//     console.log("Dispute Reason:", details.reason);
//     console.log("Dispute Amount:", details.dispute_amount?.value, details.dispute_amount?.currency_code);

//     // 3. Store dispute into SQLite
//     db.prepare(`
//       INSERT OR REPLACE INTO disputes (dispute_id, capture_id, reason, status, dispute_amount, response_deadline, source)
//       VALUES (?, ?, ?, ?, ?, ?, ?)
//     `).run(
//       realDisputeId,
//       testCaptureId,
//       details.reason || "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
//       details.status || "WAITING_FOR_SELLER_RESPONSE",
//       parseFloat(details.dispute_amount?.value || 5.00),
//       details.seller_response_due_date || null,
//       "PAYPAL"
//     );

//     console.log("Step 3: Dispute successfully stored in SQLite.");
//     console.log("--- OCT 27 GATE PASSED SUCCESSFULLY! ---");
//   } catch (err) {
//     console.error("Verification failed:", err);
//   }
// }

// verifyGateWithDisputeId();






// require("dotenv").config();

// const { Agent, setGlobalDispatcher } = require("undici");

// // Configure longer HTTP connection timeouts
// setGlobalDispatcher(
//   new Agent({
//     headersTimeout: 120000,
//     bodyTimeout: 120000,
//     connectTimeout: 30000,
//     keepAliveTimeout: 60000
//   })
// );

// async function testGemini() {
//   console.log("Starting Gemini test...");

//   const apiKey = process.env.GEMINI_API_KEY;
//   const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

//   if (!apiKey) {
//     console.log("API KEY MISSING");
//     return;
//   }

//   try {
//     const response = await fetch(
//       `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
//       {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//           "x-goog-api-key": apiKey
//         },
//         body: JSON.stringify({
//           contents: [{
//             parts: [{ text: "Reply with exactly OK" }]
//           }],
//           generationConfig: {
//             maxOutputTokens: 30
//           }
//         }),
//         signal: AbortSignal.timeout(120000)
//       }
//     );

//     console.log("HTTP STATUS:", response.status);

//     const data = await response.json();

//     console.log("GEMINI RESPONSE:", JSON.stringify(data, null, 2));

//   } catch (error) {
//     console.error("GEMINI ERROR:", error);
//     console.error("CAUSE:", error.cause);
//   }
// }

// testGemini();



require("dotenv").config();
const db = require("./db");
const { createSandboxDispute } = require("./paypalDisputes");
const { analyzeDispute } = require("./agent");

async function run() {
  const latestOrder = db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 1").get();
  if (!latestOrder) {
    console.error("No orders found in database!");
    process.exit(1);
  }

  console.log("Found latest order:", latestOrder.order_id, "| Capture ID:", latestOrder.capture_id);

  let disputeId = "PP-R-" + Math.random().toString(36).substring(2, 5).toUpperCase() + "-" + Date.now().toString().slice(-8);
  let source = "INTERNAL_FORM";

  try {
    const result = await createSandboxDispute({
      captureId: latestOrder.capture_id,
      amount: latestOrder.amount,
      reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
    });
    if (result && (result.dispute_id || result.data?.dispute_id)) {
      disputeId = result.dispute_id || result.data.dispute_id;
      source = "PAYPAL";
    }
  } catch (err) {
    console.warn("[PayPal Sandbox Simulator 500 Bypass] Using simulated dispute ID:", disputeId);
  }

  // Save the dispute into SQLite
  db.prepare(`
    INSERT OR REPLACE INTO disputes (dispute_id, capture_id, reason, status, dispute_amount, response_deadline, source)
    VALUES (?, ?, ?, 'NEEDS_RESPONSE', ?, datetime('now', '+10 days'), ?)
  `).run(
    disputeId,
    latestOrder.capture_id,
    "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    latestOrder.amount,
    source
  );

  // Trigger Gemini AI Triage & Integrity Guard verification immediately
  console.log("Running Gemini AI & Integrity Guard analysis...");
  const analysis = await analyzeDispute(disputeId);
  console.log("Done! Dispute ID:", disputeId, "| Strategy:", analysis.strategy, "| Integrity:", analysis.integrity.verdict);
}

run().catch(console.error);