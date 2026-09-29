require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PRODUCT_SERVICE_PORT || process.env.PORT || 3002;
const MONGO_URI = process.env.MONGO_URI;

app.use(cors());
app.use(express.json());

// In-Memory fallback store with seeded sample data for reliability
let productsStore = [
  { id: "501", _id: "501", name: "Data Structures Textbook", price: 49.99, category: "Books", stock: 25 },
  { id: "502", _id: "502", name: "Campus Backpack", price: 34.50, category: "Accessories", stock: 40 },
  { id: "503", _id: "503", name: "Scientific Calculator FX-991", price: 22.00, category: "Electronics", stock: 15 }
];

// Mongoose Schema
const productSchema = new mongoose.Schema({
  customId: { type: String, unique: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, default: "General" },
  stock: { type: Number, default: 0 }
}, { timestamps: true });

const Product = mongoose.models.Product || mongoose.model("Product", productSchema);

let isMongoConnected = false;

if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(async () => {
      isMongoConnected = true;
      console.log(`[Product Service] Connected to MongoDB at ${MONGO_URI}`);
      const count = await Product.countDocuments();
      if (count === 0) {
        await Product.insertMany([
          { customId: "501", name: "Data Structures Textbook", price: 49.99, category: "Books", stock: 25 },
          { customId: "502", name: "Campus Backpack", price: 34.50, category: "Accessories", stock: 40 },
          { customId: "503", name: "Scientific Calculator FX-991", price: 22.00, category: "Electronics", stock: 15 }
        ]);
        console.log("[Product Service] Seeded initial sample products into MongoDB.");
      }
    })
    .catch((err) => {
      console.warn(`[Product Service] MongoDB connection warning: ${err.message}. Falling back to in-memory store.`);
    });
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

// Health Check
app.get("/health", (req, res) => {
  res.status(200).json({ service: "product-service", status: "UP", dbConnected: isMongoConnected, port: PORT });
});

// GET /products
app.get("/products", async (req, res) => {
  try {
    if (isMongoConnected) {
      const dbProducts = await Product.find();
      const formatted = dbProducts.map(p => ({
        id: p.customId || p._id.toString(),
        _id: p._id.toString(),
        name: p.name,
        price: p.price,
        category: p.category,
        stock: p.stock
      }));
      return res.status(200).json(formatted);
    } else {
      return res.status(200).json(productsStore);
    }
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// GET /products/:id
app.get("/products/:id", async (req, res) => {
  const { id } = req.params;
  try {
    if (isMongoConnected) {
      let product = await Product.findOne({ customId: id });
      if (!product && mongoose.Types.ObjectId.isValid(id)) {
        product = await Product.findById(id);
      }
      if (!product) {
        return res.status(404).json({ status: 404, error: "Not Found", message: `Product with ID ${id} not found` });
      }
      return res.status(200).json({
        id: product.customId || product._id.toString(),
        _id: product._id.toString(),
        name: product.name,
        price: product.price,
        category: product.category,
        stock: product.stock
      });
    } else {
      const product = productsStore.find(p => p.id === id || p._id === id);
      if (!product) {
        return res.status(404).json({ status: 404, error: "Not Found", message: `Product with ID ${id} not found` });
      }
      return res.status(200).json(product);
    }
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// POST /products
app.post("/products", async (req, res) => {
  const { name, price, category, stock, customId } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ status: 400, error: "Bad Request", message: "Missing required fields: name and price are required" });
  }

  try {
    const assignedId = customId || `prod_${Date.now()}`;
    if (isMongoConnected) {
      const newProd = await Product.create({
        customId: assignedId,
        name,
        price: Number(price),
        category: category || "General",
        stock: stock !== undefined ? Number(stock) : 10
      });
      return res.status(201).json({
        id: newProd.customId || newProd._id.toString(),
        _id: newProd._id.toString(),
        name: newProd.name,
        price: newProd.price,
        category: newProd.category,
        stock: newProd.stock
      });
    } else {
      const newProd = {
        id: assignedId,
        _id: assignedId,
        name,
        price: Number(price),
        category: category || "General",
        stock: stock !== undefined ? Number(stock) : 10
      };
      productsStore.push(newProd);
      return res.status(201).json(newProd);
    }
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// PUT /products/:id
app.put("/products/:id", async (req, res) => {
  const { id } = req.params;
  const { name, price, category, stock } = req.body;

  try {
    if (isMongoConnected) {
      let product = await Product.findOne({ customId: id });
      if (!product && mongoose.Types.ObjectId.isValid(id)) {
        product = await Product.findById(id);
      }
      if (!product) {
        return res.status(404).json({ status: 404, error: "Not Found", message: `Product with ID ${id} not found` });
      }

      if (name) product.name = name;
      if (price !== undefined) product.price = Number(price);
      if (category) product.category = category;
      if (stock !== undefined) product.stock = Number(stock);

      await product.save();
      return res.status(200).json({
        id: product.customId || product._id.toString(),
        _id: product._id.toString(),
        name: product.name,
        price: product.price,
        category: product.category,
        stock: product.stock
      });
    } else {
      const index = productsStore.findIndex(p => p.id === id || p._id === id);
      if (index === -1) {
        return res.status(404).json({ status: 404, error: "Not Found", message: `Product with ID ${id} not found` });
      }
      productsStore[index] = {
        ...productsStore[index],
        ...(name && { name }),
        ...(price !== undefined && { price: Number(price) }),
        ...(category && { category }),
        ...(stock !== undefined && { stock: Number(stock) })
      };
      return res.status(200).json(productsStore[index]);
    }
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// DELETE /products/:id
app.delete("/products/:id", async (req, res) => {
  const { id } = req.params;
  try {
    if (isMongoConnected) {
      let deleted = await Product.findOneAndDelete({ customId: id });
      if (!deleted && mongoose.Types.ObjectId.isValid(id)) {
        deleted = await Product.findByIdAndDelete(id);
      }
      if (!deleted) {
        return res.status(404).json({ status: 404, error: "Not Found", message: `Product with ID ${id} not found` });
      }
      return res.status(200).json({ message: `Product ${id} deleted successfully` });
    } else {
      const index = productsStore.findIndex(p => p.id === id || p._id === id);
      if (index === -1) {
        return res.status(404).json({ status: 404, error: "Not Found", message: `Product with ID ${id} not found` });
      }
      productsStore.splice(index, 1);
      return res.status(200).json({ message: `Product ${id} deleted successfully` });
    }
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ status: 404, error: "Not Found", message: `Route ${req.method} ${req.originalUrl} not found on Product Service` });
});

app.listen(PORT, () => {
  console.log(`[Product Service] Server listening on port ${PORT}`);
});
