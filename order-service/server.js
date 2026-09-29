require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.ORDER_SERVICE_PORT || process.env.PORT || 3003;
const MONGO_URI = process.env.MONGO_URI;

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || "http://user-service:3001";
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || "http://product-service:3002";

app.use(cors());
app.use(express.json());

// In-Memory store fallback
let ordersStore = [
  {
    id: "ord_901",
    _id: "ord_901",
    userId: "101",
    productId: "501",
    quantity: 2,
    totalPrice: 99.98,
    status: "CONFIRMED",
    user: { id: "101", name: "Alice Johnson", email: "alice@campusconnect.edu" },
    product: { id: "501", name: "Data Structures Textbook", price: 49.99 },
    createdAt: new Date().toISOString()
  }
];

// Mongoose Schema
const orderSchema = new mongoose.Schema({
  customId: { type: String, unique: true },
  userId: { type: String, required: true },
  productId: { type: String, required: true },
  quantity: { type: Number, required: true, default: 1 },
  totalPrice: { type: Number, required: true },
  status: { type: String, default: "CONFIRMED" },
  userSummary: {
    name: String,
    email: String
  },
  productSummary: {
    name: String,
    price: Number
  }
}, { timestamps: true });

const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);

let isMongoConnected = false;

if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(async () => {
      isMongoConnected = true;
      console.log(`[Order Service] Connected to MongoDB at ${MONGO_URI}`);
      const count = await Order.countDocuments();
      if (count === 0) {
        await Order.create({
          customId: "ord_901",
          userId: "101",
          productId: "501",
          quantity: 2,
          totalPrice: 99.98,
          status: "CONFIRMED",
          userSummary: { name: "Alice Johnson", email: "alice@campusconnect.edu" },
          productSummary: { name: "Data Structures Textbook", price: 49.99 }
        });
        console.log("[Order Service] Seeded initial sample order into MongoDB.");
      }
    })
    .catch((err) => {
      console.warn(`[Order Service] MongoDB connection warning: ${err.message}. Falling back to in-memory store.`);
    });
}

// ── Inter-Service Communication Helpers ────────────────────────────────────────

/**
 * Fetch resource with custom timeout & error handling
 */
async function fetchService(url, serviceName) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 sec timeout

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.status === 404) {
      return { ok: false, status: 404, error: `${serviceName} returned resource not found` };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, error: `${serviceName} returned HTTP ${response.status}` };
    }
    const data = await response.json();
    return { ok: true, data };
  } catch (err) {
    clearTimeout(timeoutId);
    console.error(`[Order Service -> ${serviceName}] Communication failure: ${err.message}`);
    return { ok: false, status: 503, error: `${serviceName} is currently unavailable (${err.message})` };
  }
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

// Health Check
app.get("/health", (req, res) => {
  res.status(200).json({
    service: "order-service",
    status: "UP",
    dbConnected: isMongoConnected,
    port: PORT,
    dependencies: {
      userService: USER_SERVICE_URL,
      productService: PRODUCT_SERVICE_URL
    }
  });
});

// GET /orders
app.get("/orders", async (req, res) => {
  try {
    if (isMongoConnected) {
      const dbOrders = await Order.find();
      const formatted = dbOrders.map(o => ({
        id: o.customId || o._id.toString(),
        _id: o._id.toString(),
        userId: o.userId,
        productId: o.productId,
        quantity: o.quantity,
        totalPrice: o.totalPrice,
        status: o.status,
        user: o.userSummary,
        product: o.productSummary,
        createdAt: o.createdAt
      }));
      return res.status(200).json(formatted);
    } else {
      return res.status(200).json(ordersStore);
    }
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// GET /orders/:id
app.get("/orders/:id", async (req, res) => {
  const { id } = req.params;
  try {
    if (isMongoConnected) {
      let order = await Order.findOne({ customId: id });
      if (!order && mongoose.Types.ObjectId.isValid(id)) {
        order = await Order.findById(id);
      }
      if (!order) {
        return res.status(404).json({ status: 404, error: "Not Found", message: `Order with ID ${id} not found` });
      }
      return res.status(200).json({
        id: order.customId || order._id.toString(),
        _id: order._id.toString(),
        userId: order.userId,
        productId: order.productId,
        quantity: order.quantity,
        totalPrice: order.totalPrice,
        status: order.status,
        user: order.userSummary,
        product: order.productSummary,
        createdAt: order.createdAt
      });
    } else {
      const order = ordersStore.find(o => o.id === id || o._id === id);
      if (!order) {
        return res.status(404).json({ status: 404, error: "Not Found", message: `Order with ID ${id} not found` });
      }
      return res.status(200).json(order);
    }
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// POST /orders (Service-to-Service REST Communication)
app.post("/orders", async (req, res) => {
  const { userId, productId, quantity } = req.body;

  if (!userId || !productId) {
    return res.status(400).json({
      status: 400,
      error: "Bad Request",
      message: "Missing required fields: userId and productId are required"
    });
  }

  const orderQty = quantity ? Number(quantity) : 1;

  // Step 1: Validate User via REST call to User Service
  const userUrl = `${USER_SERVICE_URL}/users/${userId}`;
  console.log(`[Order Service] Requesting User validation: GET ${userUrl}`);
  const userResult = await fetchService(userUrl, "User Service");

  if (!userResult.ok) {
    if (userResult.status === 503) {
      return res.status(503).json({
        status: 503,
        error: "Service Unavailable",
        message: `Order placement failed: User Service is currently unavailable. (${userResult.error})`
      });
    }
    if (userResult.status === 404) {
      return res.status(404).json({
        status: 404,
        error: "Not Found",
        message: `Order placement failed: User with ID ${userId} does not exist.`
      });
    }
    return res.status(userResult.status).json({
      status: userResult.status,
      error: "Dependency Error",
      message: userResult.error
    });
  }

  // Step 2: Validate Product via REST call to Product Service
  const productUrl = `${PRODUCT_SERVICE_URL}/products/${productId}`;
  console.log(`[Order Service] Requesting Product validation: GET ${productUrl}`);
  const productResult = await fetchService(productUrl, "Product Service");

  if (!productResult.ok) {
    if (productResult.status === 503) {
      return res.status(503).json({
        status: 503,
        error: "Service Unavailable",
        message: `Order placement failed: Product Service is currently unavailable. (${productResult.error})`
      });
    }
    if (productResult.status === 404) {
      return res.status(404).json({
        status: 404,
        error: "Not Found",
        message: `Order placement failed: Product with ID ${productId} does not exist.`
      });
    }
    return res.status(productResult.status).json({
      status: productResult.status,
      error: "Dependency Error",
      message: productResult.error
    });
  }

  const userData = userResult.data;
  const productData = productResult.data;

  // Step 3: Calculate total price & construct order
  const totalPrice = Number((productData.price * orderQty).toFixed(2));
  const orderId = `ord_${Date.now()}`;

  const newOrder = {
    id: orderId,
    _id: orderId,
    userId,
    productId,
    quantity: orderQty,
    totalPrice,
    status: "CONFIRMED",
    user: {
      id: userData.id,
      name: userData.name,
      email: userData.email,
      role: userData.role
    },
    product: {
      id: productData.id,
      name: productData.name,
      price: productData.price,
      category: productData.category
    },
    createdAt: new Date().toISOString()
  };

  try {
    if (isMongoConnected) {
      const createdDbOrder = await Order.create({
        customId: orderId,
        userId,
        productId,
        quantity: orderQty,
        totalPrice,
        status: "CONFIRMED",
        userSummary: { name: userData.name, email: userData.email },
        productSummary: { name: productData.name, price: productData.price }
      });
      return res.status(201).json({
        ...newOrder,
        _id: createdDbOrder._id.toString()
      });
    } else {
      ordersStore.push(newOrder);
      return res.status(201).json(newOrder);
    }
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// DELETE /orders/:id
app.delete("/orders/:id", async (req, res) => {
  const { id } = req.params;
  try {
    if (isMongoConnected) {
      let deleted = await Order.findOneAndDelete({ customId: id });
      if (!deleted && mongoose.Types.ObjectId.isValid(id)) {
        deleted = await Order.findByIdAndDelete(id);
      }
      if (!deleted) {
        return res.status(404).json({ status: 404, error: "Not Found", message: `Order with ID ${id} not found` });
      }
      return res.status(200).json({ message: `Order ${id} cancelled/deleted successfully` });
    } else {
      const index = ordersStore.findIndex(o => o.id === id || o._id === id);
      if (index === -1) {
        return res.status(404).json({ status: 404, error: "Not Found", message: `Order with ID ${id} not found` });
      }
      ordersStore.splice(index, 1);
      return res.status(200).json({ message: `Order ${id} cancelled/deleted successfully` });
    }
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ status: 404, error: "Not Found", message: `Route ${req.method} ${req.originalUrl} not found on Order Service` });
});

app.listen(PORT, () => {
  console.log(`[Order Service] Server listening on port ${PORT}`);
  console.log(`[Order Service] Target User Service: ${USER_SERVICE_URL}`);
  console.log(`[Order Service] Target Product Service: ${PRODUCT_SERVICE_URL}`);
});
