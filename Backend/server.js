require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "Frontend")));   // serves the frontend folder

/* ---------- Model: what an item looks like ---------- */
const productSchema = new mongoose.Schema(
  {
    name:    { type: String, required: true, trim: true },
    qty:     { type: Number, required: true, min: 0 },
    price:   { type: Number, required: true, min: 0, default: 0 },
    restock: { type: Number, required: true, min: 0, default: 5 }
  },
  { toJSON: { virtuals: true, versionKey: false } }   // adds `id` so the frontend can use p.id
);

const Product = mongoose.model("Product", productSchema);

/* ---------- Helpers ---------- */
// Sends errors from async routes to the error handler at the bottom
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// Validation: never trust the frontend, check again here
function cleanProduct(body) {
  const name = String(body.name || "").trim();
  const qty = Number(body.qty);
  const price = Number(body.price);
  const restock = Number(body.restock);

  if (!name) return { error: "Enter an item name." };
  if (body.qty === "" || body.qty == null || !Number.isInteger(qty) || qty < 0)
    return { error: "Quantity must be a whole number, 0 or more." };
  if (!Number.isFinite(price) || price < 0)
    return { error: "Price must be 0 or more." };
  if (!Number.isInteger(restock) || restock < 0)
    return { error: "Restock level must be a whole number, 0 or more." };

  return { data: { name, qty, price, restock } };
}

/* ---------- API routes ---------- */

// READ all
app.get("/api/products", wrap(async (req, res) => {
  const products = await Product.find().sort({ _id: 1 });
  res.json(products);
}));

// CREATE
app.post("/api/products", wrap(async (req, res) => {
  const { data, error } = cleanProduct(req.body);
  if (error) return res.status(400).json({ error });
  res.status(201).json(await Product.create(data));
}));

// UPDATE (edit)
app.put("/api/products/:id", wrap(async (req, res) => {
  const { data, error } = cleanProduct(req.body);
  if (error) return res.status(400).json({ error });
  const product = await Product.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
  if (!product) return res.status(404).json({ error: "Item not found." });
  res.json(product);
}));

// SELL: lowers stock, refuses if there isn't enough
app.post("/api/products/:id/sell", wrap(async (req, res) => {
  const amount = req.body.amount == null ? 1 : Number(req.body.amount);
  if (!Number.isInteger(amount) || amount <= 0)
    return res.status(400).json({ error: "Amount must be a whole number greater than 0." });

  // One atomic step: only updates if enough stock exists
  const updated = await Product.findOneAndUpdate(
    { _id: req.params.id, qty: { $gte: amount } },
    { $inc: { qty: -amount } },
    { new: true }
  );

  if (!updated) {
    const exists = await Product.exists({ _id: req.params.id });
    return exists
      ? res.status(400).json({ error: "Not enough stock." })
      : res.status(404).json({ error: "Item not found." });
  }
  res.json(updated);
}));

// DELETE
app.delete("/api/products/:id", wrap(async (req, res) => {
  await Product.findByIdAndDelete(req.params.id);
  res.status(204).end();
}));

/* ---------- Error handler ---------- */
app.use((err, req, res, next) => {
  if (err.name === "CastError") return res.status(400).json({ error: "Invalid id." });
  console.error(err);
  res.status(500).json({ error: "Server error." });
});

/* ---------- Connect to the database, then start listening ---------- */
const PORT = process.env.PORT || 3000;
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("Connected to MongoDB");
    app.listen(PORT, () => console.log(`Running at http://localhost:${PORT}`));
  })
  .catch(err => console.error("MongoDB connection failed:", err.message));