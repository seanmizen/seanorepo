import sqlite3 from "sqlite3";
import Stripe from "stripe";
const stripe = new Stripe(
  "sk_test_51QVX2JBsGhYF8YEWi3iM9PCLwFMG2AMbKx1eq6L4mPMp6TB62S9tve5NypbQmeiTTJ9epEAJhaO01lTLOZI4Huxy0009gNLP2Z"
);
import express from "express";
const app = express();
app.use(express.static("public"));

const YOUR_DOMAIN = "http://localhost:3000";

app.post("/create-checkout-session", async (req, res) => {
  const session = await stripe.checkout.sessions.create({
    ui_mode: "embedded",
    line_items: [
      {
        // Provide the exact Price ID (for example, pr_1234) of the product you want to sell
        price: "pr_1",
        quantity: 1,
      },
    ],
    mode: "payment",
    return_url: `${YOUR_DOMAIN}/return?session_id={CHECKOUT_SESSION_ID}`,
    automatic_tax: { enabled: true },
  });

  res.send({ clientSecret: session.client_secret });
});

app.get("/session-status", async (req, res) => {
  const session = await stripe.checkout.sessions.retrieve(req.query.session_id);

  res.send({
    status: session.status,
    customer_email: session.customer_details.email,
  });
});

// successful transaction. adds a sqlite row "transaction" with the session_id, customer_email, message, postal_address
// example request body:
// {
//   "session_id": "cs_test_a1b2c3d4e5f6g7h8i9j0",
//   "customer_email": "sean@seanmizen.com",
//   "message": "Hello, I would like to request a refund.",
//   "postal_address": "123 Main St, Anytown, USA"
// }

app.post("/transaction", async (req, res) => {
  const session = await stripe.checkout.sessions.retrieve(req.body.session_id);
  const customer_email = session.customer_details.email;
  const message = req.body.message;
  const postal_address = req.body.postal_address;

  // add to sqlite db
  const db = new sqlite3.Database("transactions.db");
  db.run(
    `INSERT INTO transactions (session_id, customer_email, message, postal_address) VALUES (?, ?, ?, ?)`,
    [session.id, customer_email, message, postal_address],
    (err) => {
      if (err) {
        return console.error(err.message);
      }
      console.log(`Row was added to the table`);
    }
  );
  db.close();

  res.send({ status: "success" });
});

app.get("/", async (req, res) => {
  res.send("Hello World");
});

app.get("/db-seed", async (req, res) => {
  const db = new sqlite3.Database("transactions.db");
  db.run(
    `CREATE TABLE IF NOT EXISTS transactions (
      transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT PRIMARY KEY,
      customer_email TEXT NOT NULL,
      message TEXT NOT NULL,
      postal_address TEXT NOT NULL
      send_status TEXT DEFAULT 'pending',
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    (err) => {
      if (err) {
        return console.error(err.message);
      }
      console.log(`Table was created`);
    }
  );
  db.close();

  res.send({ status: "success" });
});

app.listen(4242, () => console.log("Running on port 4242"));
