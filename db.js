// const Database = require("better-sqlite3");
// const path = require("path");

// const db = new Database(path.join(__dirname, "disputes.db"));

// // Database configuration
// db.pragma("journal_mode = WAL");
// db.pragma("foreign_keys = ON");
// db.pragma("busy_timeout = 5000");

// // Create database tables
// db.exec(`
//   CREATE TABLE IF NOT EXISTS users (
//     id INTEGER PRIMARY KEY AUTOINCREMENT,
//     email TEXT UNIQUE NOT NULL,
//     password TEXT NOT NULL,
//     name TEXT NOT NULL,
//     role TEXT CHECK(role IN ('admin', 'user')) NOT NULL
//   );

//   CREATE TABLE IF NOT EXISTS pending_orders (
//     paypal_order_id TEXT PRIMARY KEY,
//     product_id TEXT NOT NULL,
//     amount REAL NOT NULL,
//     buyer_email TEXT NOT NULL,
//     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
//   );

//   CREATE TABLE IF NOT EXISTS orders (
//     order_id TEXT PRIMARY KEY,
//     paypal_order_id TEXT,
//     capture_id TEXT UNIQUE,
//     product_name TEXT NOT NULL,
//     amount REAL NOT NULL,
//     currency TEXT DEFAULT 'USD',
//     buyer_email TEXT NOT NULL,
//     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
//   );

//   CREATE TABLE IF NOT EXISTS shipping_records (
//     record_id INTEGER PRIMARY KEY AUTOINCREMENT,
//     order_id TEXT NOT NULL,
//     carrier TEXT NOT NULL,
//     tracking_number TEXT NOT NULL UNIQUE,
//     shipped_at DATETIME NOT NULL,
//     delivered_at DATETIME,
//     delivery_status TEXT CHECK(
//       delivery_status IN ('IN_TRANSIT', 'DELIVERED', 'RETURNED')
//     ),
//     signature_present BOOLEAN DEFAULT 0,
//     FOREIGN KEY (order_id)
//       REFERENCES orders(order_id) ON DELETE CASCADE
//   );

//   CREATE TABLE IF NOT EXISTS disputes (
//     dispute_id TEXT PRIMARY KEY,
//     capture_id TEXT NOT NULL,
//     reason TEXT NOT NULL,
//     status TEXT NOT NULL,
//     dispute_amount REAL NOT NULL,
//     currency TEXT DEFAULT 'USD',
//     response_deadline DATETIME,
//     source TEXT CHECK(source IN ('PAYPAL', 'INTERNAL_FORM')),
//     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
//   );

//   CREATE TABLE IF NOT EXISTS ai_decisions (
//     decision_id INTEGER PRIMARY KEY AUTOINCREMENT,
//     dispute_id TEXT NOT NULL,
//     strategy TEXT CHECK(
//       strategy IN ('FIGHT', 'ACCEPT', 'MESSAGE_BUYER')
//     ),
//     reasoning TEXT NOT NULL,
//     draft_response TEXT NOT NULL,
//     integrity_verdict TEXT CHECK(
//       integrity_verdict IN ('PASSED', 'BLOCKED')
//     ),
//     violations_found TEXT,
//     confidence_score REAL,
//     action_suggested TEXT,
//     model_name TEXT,
//     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
//     FOREIGN KEY (dispute_id)
//       REFERENCES disputes(dispute_id) ON DELETE CASCADE
//   );

//   CREATE TABLE IF NOT EXISTS audit_log (
//     log_id INTEGER PRIMARY KEY AUTOINCREMENT,
//     actor TEXT CHECK(
//       actor IN ('AI', 'INTEGRITY_CHECK', 'SELLER', 'WEBHOOK')
//     ),
//     action TEXT NOT NULL,
//     details TEXT NOT NULL,
//     timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
//   );
// `);

// // --------------------------------------------------
// // SAFE DATABASE MIGRATIONS
// // --------------------------------------------------

// function ensureColumn(table, column, definition) {
//   const columns = db.prepare(`PRAGMA table_info(${table})`).all();
//   const exists = columns.some(col => col.name === column);

//   if (!exists) {
//     db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
//     console.log(`[DB Migration] Added ${table}.${column}`);
//   }
// }

// // Payment traceability & decision tracking
// ensureColumn("orders", "paypal_order_id", "TEXT");
// ensureColumn("ai_decisions", "confidence_score", "REAL");
// ensureColumn("ai_decisions", "action_suggested", "TEXT");
// ensureColumn("ai_decisions", "model_name", "TEXT");

// // --------------------------------------------------
// // PERFORMANCE INDEXES
// // --------------------------------------------------

// db.exec(`
//   CREATE INDEX IF NOT EXISTS idx_orders_capture
//   ON orders(capture_id);

//   CREATE INDEX IF NOT EXISTS idx_disputes_capture
//   ON disputes(capture_id);

//   CREATE INDEX IF NOT EXISTS idx_disputes_status
//   ON disputes(status);

//   CREATE INDEX IF NOT EXISTS idx_ai_dispute
//   ON ai_decisions(dispute_id);

//   CREATE INDEX IF NOT EXISTS idx_audit_timestamp
//   ON audit_log(timestamp);
// `);

// // --------------------------------------------------
// // DEMO ACCOUNTS SEEDING
// // --------------------------------------------------

// const insertUser = db.prepare(`
//   INSERT OR IGNORE INTO users (email, password, name, role)
//   VALUES (?, ?, ?, ?)
// `);

// insertUser.run("admin@store.com", "admin123", "Store Admin", "admin");
// insertUser.run("john@example.com", "user123", "John Doe", "user");

// console.log("PayPal Dispute AI Database Initialized Successfully.");

// module.exports = db;



const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(
  path.join(__dirname, "disputes.db")
);

// --------------------------------------------------
// DATABASE CONFIGURATION
// --------------------------------------------------

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

// --------------------------------------------------
// CREATE DATABASE TABLES
// --------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT CHECK(role IN ('admin', 'user')) NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pending_orders (
    paypal_order_id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    amount REAL NOT NULL,
    buyer_email TEXT NOT NULL,
    buyer_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    order_id TEXT PRIMARY KEY,
    paypal_order_id TEXT,
    capture_id TEXT UNIQUE,
    product_name TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    buyer_email TEXT NOT NULL,
    buyer_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS shipping_records (
    record_id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    carrier TEXT NOT NULL,
    tracking_number TEXT NOT NULL UNIQUE,
    shipped_at DATETIME NOT NULL,
    delivered_at DATETIME,
    delivery_status TEXT CHECK(
      delivery_status IN (
        'IN_TRANSIT',
        'DELIVERED',
        'RETURNED'
      )
    ),
    signature_present BOOLEAN DEFAULT 0,
    FOREIGN KEY (order_id)
      REFERENCES orders(order_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS disputes (
    dispute_id TEXT PRIMARY KEY,
    capture_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL,
    dispute_amount REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    response_deadline DATETIME,
    source TEXT CHECK(
      source IN ('PAYPAL', 'INTERNAL_FORM')
    ),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ai_decisions (
    decision_id INTEGER PRIMARY KEY AUTOINCREMENT,
    dispute_id TEXT NOT NULL,
    strategy TEXT CHECK(
      strategy IN (
        'FIGHT',
        'ACCEPT',
        'MESSAGE_BUYER'
      )
    ),
    reasoning TEXT NOT NULL,
    draft_response TEXT NOT NULL,
    integrity_verdict TEXT CHECK(
      integrity_verdict IN ('PASSED', 'BLOCKED')
    ),
    violations_found TEXT,
    confidence_score REAL,
    action_suggested TEXT,
    model_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dispute_id)
      REFERENCES disputes(dispute_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT CHECK(
      actor IN (
        'AI',
        'INTEGRITY_CHECK',
        'SELLER',
        'WEBHOOK'
      )
    ),
    action TEXT NOT NULL,
    details TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// --------------------------------------------------
// SAFE DATABASE MIGRATIONS
// --------------------------------------------------

function ensureColumn(table, column, definition) {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all();

  const exists = columns.some(
    col => col.name === column
  );

  if (!exists) {
    db.exec(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
    );

    console.log(
      `[DB Migration] Added ${table}.${column}`
    );
  }
}

// Orders: buyer information
ensureColumn("orders", "paypal_order_id", "TEXT");
ensureColumn("orders", "buyer_name", "TEXT");

// Pending orders: buyer information
ensureColumn("pending_orders", "buyer_name", "TEXT");

// AI decision tracking
ensureColumn("ai_decisions", "confidence_score", "REAL");
ensureColumn("ai_decisions", "action_suggested", "TEXT");
ensureColumn("ai_decisions", "model_name", "TEXT");

// --------------------------------------------------
// PERFORMANCE INDEXES
// --------------------------------------------------

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_orders_capture
  ON orders(capture_id);

  CREATE INDEX IF NOT EXISTS idx_orders_buyer_email
  ON orders(buyer_email);

  CREATE INDEX IF NOT EXISTS idx_users_email
  ON users(email);

  CREATE INDEX IF NOT EXISTS idx_disputes_capture
  ON disputes(capture_id);

  CREATE INDEX IF NOT EXISTS idx_disputes_status
  ON disputes(status);

  CREATE INDEX IF NOT EXISTS idx_ai_dispute
  ON ai_decisions(dispute_id);

  CREATE INDEX IF NOT EXISTS idx_ai_latest
  ON ai_decisions(dispute_id, decision_id DESC);

  CREATE INDEX IF NOT EXISTS idx_shipping_order
  ON shipping_records(order_id);

  CREATE INDEX IF NOT EXISTS idx_audit_timestamp
  ON audit_log(timestamp);
`);

// --------------------------------------------------
// DEMO ACCOUNTS SEEDING
// --------------------------------------------------

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (
    email,
    password,
    name,
    role
  )
  VALUES (?, ?, ?, ?)
`);

insertUser.run(
  "admin@store.com",
  "admin123",
  "Store Admin",
  "admin"
);

insertUser.run(
  "john@example.com",
  "user123",
  "John Doe",
  "user"
);

// --------------------------------------------------
// DATABASE VALIDATION
// --------------------------------------------------

const orderColumns = db
  .prepare("PRAGMA table_info(orders)")
  .all()
  .map(column => column.name);

console.log(
  "[DB] Orders columns:",
  orderColumns.join(", ")
);

console.log(
  "[DB] PayPal Dispute AI Database Initialized Successfully."
);

// --------------------------------------------------
// EXPORT DATABASE
// --------------------------------------------------

module.exports = db;
