require("dotenv").config();
const express = require("express");
const path = require("path");
const db = require("./db");
const {
  submitEvidence,
  acceptClaim,
  getDisputeDetails,
  createOrder,
  captureOrder,
} = require("./paypalDisputes");
const { analyzeDispute, chatWithCopilot } = require("./agent");
// const { analyzeDispute } = require("./agent");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "Public")));
app.use(express.json());

// Prevent browser from caching protected HTML pages
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
});

app.use(express.static(path.join(__dirname, "Public")));
// ----------------------------------------------------
// 1. DISPUTES & COPILOT ENDPOINTS
// ----------------------------------------------------

// Get All Disputes with AI Recommendations
app.get("/api/disputes", (req, res) => {
  try {
    const disputes = db
      .prepare(
        `
      SELECT 
        d.dispute_id,
        d.capture_id,
        d.reason,
        d.status,
        d.dispute_amount,
        d.response_deadline,
        o.order_id,
        o.product_name,
        o.buyer_email,
        s.carrier,
        s.tracking_number,
        s.delivery_status,
        a.strategy,
        a.reasoning,
        a.draft_response,
        a.integrity_verdict
      FROM disputes d
      LEFT JOIN orders o ON d.capture_id = o.capture_id
      LEFT JOIN shipping_records s ON o.order_id = s.order_id
      LEFT JOIN ai_decisions a ON d.dispute_id = a.dispute_id
      ORDER BY d.created_at DESC
    `
      )
      .all();

    res.json({ success: true, data: disputes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Trigger AI Analysis for a Dispute
app.post("/api/disputes/:id/analyze", async (req, res) => {
  try {
    const disputeId = req.params.id;
    const result = await analyzeDispute(disputeId);
    res.json({ success: true, analysis: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// One-Click PayPal Evidence Submission (FIGHT)
app.post("/api/disputes/:id/submit-defense", async (req, res) => {
  const disputeId = req.params.id;

  try {
    const dispute = db
      .prepare("SELECT * FROM disputes WHERE dispute_id = ?")
      .get(disputeId);
    const order = db
      .prepare("SELECT * FROM orders WHERE capture_id = ?")
      .get(dispute.capture_id);
    const shipping = order
      ? db
          .prepare("SELECT * FROM shipping_records WHERE order_id = ?")
          .get(order.order_id)
      : null;
    const decision = db
      .prepare("SELECT * FROM ai_decisions WHERE dispute_id = ?")
      .get(disputeId);

    if (!shipping || !decision) {
      return res
        .status(400)
        .json({ success: false, message: "Missing shipping record or AI decision." });
    }

    if (decision.integrity_verdict !== "PASSED") {
      return res
        .status(403)
        .json({ success: false, message: "Integrity Guard blocked this defense submission." });
    }

    // Call PayPal REST API to contest
    const paypalResult = await submitEvidence(disputeId, {
      trackingNumber: shipping.tracking_number,
      carrier: shipping.carrier,
      note: decision.draft_response,
    });

    // Update status in local DB
    db.prepare("UPDATE disputes SET status = ? WHERE dispute_id = ?").run(
      "UNDER_REVIEW",
      disputeId
    );

    db.prepare("INSERT INTO audit_log (actor, action, details) VALUES (?, ?, ?)").run(
      "SELLER",
      "SUBMITTED_EVIDENCE",
      JSON.stringify({ disputeId, paypalResult })
    );

    res.json({
      success: true,
      message: "Defense submitted to PayPal successfully!",
      paypalResult,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// One-Click PayPal Refund / Accept Claim
app.post("/api/disputes/:id/accept-claim", async (req, res) => {
  const disputeId = req.params.id;
  try {
    const paypalResult = await acceptClaim(disputeId);
    db.prepare("UPDATE disputes SET status = ? WHERE dispute_id = ?").run(
      "RESOLVED",
      disputeId
    );

    db.prepare("INSERT INTO audit_log (actor, action, details) VALUES (?, ?, ?)").run(
      "SELLER",
      "ACCEPTED_CLAIM",
      JSON.stringify({ disputeId, paypalResult })
    );

    res.json({
      success: true,
      message: "Claim accepted and refund initiated via PayPal.",
      paypalResult,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// 2. CHECKOUT & STOREFRONT ENDPOINTS
// ----------------------------------------------------

// Provide Client ID to frontend securely
app.get("/api/checkout/config", (req, res) => {
  res.json({ clientId: process.env.PAYPAL_CLIENT_ID });
});

// Create PayPal Order
app.post("/api/paypal/create-order", async (req, res) => {
  try {
    const amount = Number(req.body.amount || 5).toFixed(2);
    const order = await createOrder(amount, "USD");
    // ... save amount to pending_orders ...
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Capture PayPal Order & Auto-Seed Shipping Record
app.post("/api/checkout/capture-order", async (req, res) => {
  try {
    const { orderID, productName, buyerEmail } = req.body;
    const captureData = await captureOrder(orderID);

    if (captureData.status === "COMPLETED") {
      const captureId = captureData.purchase_units[0].payments.captures[0].id;
      const internalOrderId = "ORD-" + Date.now().toString().slice(-6);

      // Save Order to SQLite
      db.prepare(
        `
        INSERT INTO orders (order_id, capture_id, product_name, amount, buyer_email)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(
        internalOrderId,
        captureId,
        productName || "RGB Mechanical Keyboard",
        5.0,
        buyerEmail || "buyer@personal.example.com"
      );

      // Auto-assign mock shipping record
      db.prepare(
        `
        INSERT INTO shipping_records (order_id, carrier, tracking_number, shipped_at, delivered_at, delivery_status, signature_present)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        internalOrderId,
        "FEDEX",
        "TRACK-FDX-" + Math.floor(100000 + Math.random() * 900000),
        new Date().toISOString(),
        new Date(Date.now() + 86400000).toISOString(),
        "DELIVERED",
        1
      );

      return res.json({ success: true, captureId, internalOrderId });
    }

    res.status(400).json({ success: false, data: captureData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ----------------------------------------------------
// AUTHENTICATION & CUSTOMER ROUTES
// ----------------------------------------------------

// User Login Check
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare("SELECT id, email, name, role FROM users WHERE email = ? AND password = ?").get(email, password);

  if (!user) {
    return res.status(401).json({ success: false, message: "Invalid email or password." });
  }

  res.json({ success: true, user });
});

app.post("/api/register", (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: "All fields are required." });
  }

  try {
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      return res.status(400).json({ success: false, message: "Email already registered." });
    }

    // Role is hard-locked to 'user' for public registrations
    const info = db.prepare(`
      INSERT INTO users (name, email, password, role)
      VALUES (?, ?, ?, 'user')
    `).run(name, email, password);

    res.json({ 
      success: true, 
      user: { id: info.lastInsertRowid, name, email, role: "user" } 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
app.post("/api/logout", (req, res) => {
  if (req.session) req.session.destroy();
  res.json({ success: true });
});
// Get Logged-in Customer Orders & Shipping status
app.get("/api/user/orders", (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: "Missing email parameter" });

  const orders = db.prepare(`
    SELECT o.order_id, o.product_name, o.amount, o.created_at,
           s.carrier, s.tracking_number, s.delivery_status
    FROM orders o
    LEFT JOIN shipping_records s ON o.order_id = s.order_id
    WHERE o.buyer_email = ?
    ORDER BY o.created_at DESC
  `).all(email);

  res.json({ success: true, data: orders });
});
// Live Chat with Dispute Copilot
app.post("/api/disputes/:id/chat", async (req, res) => {
  try {
    const disputeId = req.params.id;
    const { message, history } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });

    const aiResponse = await chatWithCopilot(disputeId, message, history || []);
    res.json({ success: true, ...aiResponse });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
// ----------------------------------------------------
// 3. START SERVER
// ----------------------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 Merchant Defense Copilot running at: http://localhost:${PORT}`);
});


