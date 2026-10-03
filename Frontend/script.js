/* ---------- Settings ---------- */
const CURRENCY = "$";

/* ---------- Data: a copy of what the server has ---------- */
let products = [];
let editingId = null;   // id being edited, or null when adding
let filter = "all";     // "all" or "low"
let flashId = null;     // product whose row just changed

/* ---------- Shortcuts and helpers ---------- */
const $ = id => document.getElementById(id);
const form = $("itemForm");
const rows = $("rows");
const msg = $("msg");

const money = n =>
  CURRENCY + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const isLow = p => p.qty <= p.restock;

// Creates an element with a class and text (textContent keeps user input safe)
function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function actionBtn(text, className, action, id, label) {
  const b = el("button", className, text);
  b.type = "button";
  b.dataset.action = action;   // read later by the click handler
  b.dataset.id = id;
  b.setAttribute("aria-label", label);
  return b;
}

function showMessage(text) {
  msg.textContent = text;
}

/* ---------- Talking to the backend ---------- */

// Calls the API. Throws an Error with the backend's message if the request fails.
async function api(url, options) {
  const res = await fetch(url, options);
  if (res.status === 204) return null;       // success, nothing to return
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// Builds the options for a request that sends JSON
const send = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

// Gets all items from the server, then redraws the page
async function loadProducts() {
  try {
    products = await api("/api/products");
    render();
  } catch (e) {
    showMessage("Could not load items. Is the server running?");
  }
}

/* ---------- Render: draws everything from the products array ---------- */
function render() {
  const term = $("search").value.trim().toLowerCase();
  const lowCount = products.filter(isLow).length;

  // Totals use ALL products, not just the filtered ones
  $("tItems").textContent = products.length;
  $("tUnits").textContent = products.reduce((sum, p) => sum + p.qty, 0);
  $("tValue").textContent = money(products.reduce((sum, p) => sum + p.qty * p.price, 0));
  $("tLow").textContent = lowCount;
  $("tLow").classList.toggle("is-low", lowCount > 0);
  $("filterLow").textContent = `Low stock (${lowCount})`;

  // Apply search and filter
  const visible = products.filter(p =>
    p.name.toLowerCase().includes(term) && (filter === "all" || isLow(p))
  );

  rows.replaceChildren();
  if (!visible.length) {
    const tr = el("tr");
    const td = el("td", "empty", products.length ? "No items match." : "No items yet. Add one above.");
    td.colSpan = 4;
    tr.append(td);
    rows.append(tr);
  } else {
    visible.forEach(p => rows.append(buildRow(p)));
  }
  flashId = null;
}

function buildRow(p) {
  const tr = el("tr", isLow(p) ? "low" : "");

  const nameTd = el("td");
  nameTd.append(el("span", "name", p.name));
  if (isLow(p)) nameTd.append(el("span", "badge", p.qty === 0 ? "Sold out" : "Low stock"));
  nameTd.append(el("span", "sub", `Restock at ${p.restock}`));

  const qtyTd = el("td", p.id === flashId ? "num qty flash" : "num qty", p.qty);
  const priceTd = el("td", "num", money(p.price));

  const sell = actionBtn("Sell 1", "sell", "sell", p.id,
    p.qty === 0 ? `${p.name} is sold out` : `Sell 1 ${p.name}`);
  sell.disabled = p.qty === 0;
  const edit = actionBtn("Edit", "", "edit", p.id, `Edit ${p.name}`);
  const del = actionBtn("Delete", "danger", "delete", p.id, `Delete ${p.name}`);

  const actions = el("div", "row-actions");
  actions.append(sell, edit, del);
  const actionsTd = el("td");
  actionsTd.append(actions);

  tr.append(nameTd, qtyTd, priceTd, actionsTd);
  return tr;
}

/* ---------- Actions: call the API, then reload the list ---------- */
async function sellOne(p) {
  try {
    await api(`/api/products/${p.id}/sell`, send("POST", { amount: 1 }));
    flashId = p.id;
    showMessage("");
    await loadProducts();
  } catch (e) {
    showMessage(e.message);
  }
}

async function removeProduct(p) {
  if (!confirm(`Delete "${p.name}"?`)) return;
  try {
    await api(`/api/products/${p.id}`, { method: "DELETE" });
    if (editingId === p.id) resetForm();
    await loadProducts();
  } catch (e) {
    showMessage(e.message);
  }
}

function startEdit(p) {
  editingId = p.id;
  $("name").value = p.name;
  $("qty").value = p.qty;
  $("price").value = p.price;
  $("restock").value = p.restock;
  $("formTitle").textContent = "Edit item";
  $("submitBtn").textContent = "Save changes";
  $("cancelBtn").hidden = false;
  form.classList.add("is-editing");
  showMessage("");
  $("name").focus();
}

function resetForm() {
  editingId = null;
  form.reset();                         // restock goes back to 5
  $("formTitle").textContent = "Add an item";
  $("submitBtn").textContent = "Add item";
  $("cancelBtn").hidden = true;
  form.classList.remove("is-editing");
}

/* ---------- Events ---------- */

// One listener for all row buttons (event delegation)
rows.addEventListener("click", e => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const product = products.find(p => p.id === btn.dataset.id);   // ids are strings from MongoDB
  if (!product) return;

  if (btn.dataset.action === "sell") sellOne(product);
  if (btn.dataset.action === "edit") startEdit(product);
  if (btn.dataset.action === "delete") removeProduct(product);
});

// Add or save
form.addEventListener("submit", async e => {
  e.preventDefault();

  const name = $("name").value.trim();
  const qtyText = $("qty").value;
  const qty = Number(qtyText);
  const price = $("price").value === "" ? 0 : Number($("price").value);
  const restock = $("restock").value === "" ? 5 : Number($("restock").value);

  // Frontend validation (the backend checks again)
  if (!name) return showMessage("Enter an item name.");
  if (qtyText === "" || !Number.isInteger(qty) || qty < 0)
    return showMessage("Quantity must be a whole number, 0 or more.");
  if (!Number.isFinite(price) || price < 0)
    return showMessage("Price must be 0 or more.");
  if (!Number.isInteger(restock) || restock < 0)
    return showMessage("Restock level must be a whole number, 0 or more.");

  const payload = { name, qty, price, restock };

  try {
    const saved = editingId
      ? await api(`/api/products/${editingId}`, send("PUT", payload))
      : await api("/api/products", send("POST", payload));
    flashId = saved.id;
    showMessage("");
    resetForm();
    await loadProducts();
  } catch (err) {
    showMessage(err.message);
  }
});

$("cancelBtn").addEventListener("click", () => { resetForm(); showMessage(""); });

$("search").addEventListener("input", render);

document.querySelectorAll(".filter button").forEach(btn => {
  btn.addEventListener("click", () => {
    filter = btn.dataset.filter;
    document.querySelectorAll(".filter button")
      .forEach(b => b.setAttribute("aria-pressed", b === btn));
    render();
  });
});

loadProducts();   // get the items from the server when the page opens