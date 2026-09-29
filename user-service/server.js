require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.USER_SERVICE_PORT || process.env.PORT || 3001;
const MONGO_URI = process.env.MONGO_URI;

app.use(cors());
app.use(express.json());

// In-Memory fallback store with seeded sample data for reliability
let usersStore = [
  { id: "101", _id: "101", name: "Alice Johnson", email: "alice@campusconnect.edu", role: "Student", department: "Computer Science" },
  { id: "102", _id: "102", name: "Bob Smith", email: "bob@campusconnect.edu", role: "Faculty", department: "Electrical Engineering" },
  { id: "103", _id: "103", name: "Charlie Brown", email: "charlie@campusconnect.edu", role: "Student", department: "Information Technology" }
];

// Mongoose Schema (used when MONGO_URI is connected)
const userSchema = new mongoose.Schema({
  customId: { type: String, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  role: { type: String, default: "Student" },
  department: { type: String, default: "General" }
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model("User", userSchema);

let isMongoConnected = false;

if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(async () => {
      isMongoConnected = true;
      console.log(`[User Service] Connected to MongoDB at ${MONGO_URI}`);
      // Seed initial data if DB is empty
      const count = await User.countDocuments();
      if (count === 0) {
        await User.insertMany([
          { customId: "101", name: "Alice Johnson", email: "alice@campusconnect.edu", role: "Student", department: "Computer Science" },
          { customId: "102", name: "Bob Smith", email: "bob@campusconnect.edu", role: "Faculty", department: "Electrical Engineering" },
          { customId: "103", name: "Charlie Brown", email: "charlie@campusconnect.edu", role: "Student", department: "Information Technology" }
        ]);
        console.log("[User Service] Seeded initial sample users into MongoDB.");
      }
    })
    .catch((err) => {
      console.warn(`[User Service] MongoDB connection warning: ${err.message}. Falling back to in-memory store.`);
    });
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

// Health Check
app.get("/health", (req, res) => {
  res.status(200).json({ service: "user-service", status: "UP", dbConnected: isMongoConnected, port: PORT });
});

// GET /users
app.get("/users", async (req, res) => {
  try {
    if (isMongoConnected) {
      const dbUsers = await User.find();
      const formatted = dbUsers.map(u => ({
        id: u.customId || u._id.toString(),
        _id: u._id.toString(),
        name: u.name,
        email: u.email,
        role: u.role,
        department: u.department
      }));
      return res.status(200).json(formatted);
    } else {
      return res.status(200).json(usersStore);
    }
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// GET /users/:id
app.get("/users/:id", async (req, res) => {
  const { id } = req.params;
  try {
    if (isMongoConnected) {
      let user = await User.findOne({ customId: id });
      if (!user && mongoose.Types.ObjectId.isValid(id)) {
        user = await User.findById(id);
      }
      if (!user) {
        return res.status(404).json({ status: 404, error: "Not Found", message: `User with ID ${id} not found` });
      }
      return res.status(200).json({
        id: user.customId || user._id.toString(),
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department
      });
    } else {
      const user = usersStore.find(u => u.id === id || u._id === id);
      if (!user) {
        return res.status(404).json({ status: 404, error: "Not Found", message: `User with ID ${id} not found` });
      }
      return res.status(200).json(user);
    }
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// POST /users
app.post("/users", async (req, res) => {
  const { name, email, role, department, customId } = req.body;
  if (!name || !email) {
    return res.status(400).json({ status: 400, error: "Bad Request", message: "Missing required fields: name and email are required" });
  }

  try {
    const assignedId = customId || `user_${Date.now()}`;
    if (isMongoConnected) {
      const newUser = await User.create({
        customId: assignedId,
        name,
        email,
        role: role || "Student",
        department: department || "General"
      });
      return res.status(201).json({
        id: newUser.customId || newUser._id.toString(),
        _id: newUser._id.toString(),
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        department: newUser.department
      });
    } else {
      const newUser = {
        id: assignedId,
        _id: assignedId,
        name,
        email,
        role: role || "Student",
        department: department || "General"
      };
      usersStore.push(newUser);
      return res.status(201).json(newUser);
    }
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// PUT /users/:id
app.put("/users/:id", async (req, res) => {
  const { id } = req.params;
  const { name, email, role, department } = req.body;

  try {
    if (isMongoConnected) {
      let user = await User.findOne({ customId: id });
      if (!user && mongoose.Types.ObjectId.isValid(id)) {
        user = await User.findById(id);
      }
      if (!user) {
        return res.status(404).json({ status: 404, error: "Not Found", message: `User with ID ${id} not found` });
      }

      if (name) user.name = name;
      if (email) user.email = email;
      if (role) user.role = role;
      if (department) user.department = department;

      await user.save();
      return res.status(200).json({
        id: user.customId || user._id.toString(),
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department
      });
    } else {
      const index = usersStore.findIndex(u => u.id === id || u._id === id);
      if (index === -1) {
        return res.status(404).json({ status: 404, error: "Not Found", message: `User with ID ${id} not found` });
      }
      usersStore[index] = {
        ...usersStore[index],
        ...(name && { name }),
        ...(email && { email }),
        ...(role && { role }),
        ...(department && { department })
      };
      return res.status(200).json(usersStore[index]);
    }
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// DELETE /users/:id
app.delete("/users/:id", async (req, res) => {
  const { id } = req.params;
  try {
    if (isMongoConnected) {
      let deleted = await User.findOneAndDelete({ customId: id });
      if (!deleted && mongoose.Types.ObjectId.isValid(id)) {
        deleted = await User.findByIdAndDelete(id);
      }
      if (!deleted) {
        return res.status(404).json({ status: 404, error: "Not Found", message: `User with ID ${id} not found` });
      }
      return res.status(200).json({ message: `User ${id} deleted successfully` });
    } else {
      const index = usersStore.findIndex(u => u.id === id || u._id === id);
      if (index === -1) {
        return res.status(404).json({ status: 404, error: "Not Found", message: `User with ID ${id} not found` });
      }
      usersStore.splice(index, 1);
      return res.status(200).json({ message: `User ${id} deleted successfully` });
    }
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ status: 404, error: "Not Found", message: `Route ${req.method} ${req.originalUrl} not found on User Service` });
});

app.listen(PORT, () => {
  console.log(`[User Service] Server listening on port ${PORT}`);
});
