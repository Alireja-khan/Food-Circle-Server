const express = require('express');
const cors = require('cors');
const app = express();
const http = require('http');
const { Server } = require('socket.io');
const port = process.env.PORT || 5000; // Changed from 3000 to 5000
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

// -------------------- Middleware --------------------
app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:3000", "your-production-url"], // Added localhost:3000
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE"]
}));
app.use(express.json());

// -------------------- Create HTTP server and Socket.IO --------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:3000", "your-production-url"], // Added localhost:3000
    methods: ["GET", "POST"]
  }
});

// -------------------- MongoDB Connection --------------------
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vgnu9ma.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// -------------------- Socket.IO Logic --------------------
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join a specific room
  socket.on('join_room', (roomId) => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room ${roomId}`);
  });

  // Handle sending messages
  socket.on('send_message', async (data) => {
    try {
      const db = client.db('foodCircle');
      const messagesCollection = db.collection('messages');
      
      const messageData = {
        roomId: data.roomId,
        senderId: data.senderId,
        senderName: data.senderName,
        message: data.message,
        timestamp: new Date()
      };

      const result = await messagesCollection.insertOne(messageData);
      messageData._id = result.insertedId;
      io.to(data.roomId).emit('receive_message', messageData);
    } catch (error) {
      console.error('Error saving message:', error);
    }
  });

  // Typing indicators
  socket.on('typing_start', (data) => {
    socket.to(data.roomId).emit('user_typing', {
      userName: data.userName,
      isTyping: true
    });
  });

  socket.on('typing_stop', (data) => {
    socket.to(data.roomId).emit('user_typing', {
      userName: data.userName,
      isTyping: false
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// -------------------- Main Run Function --------------------
async function run() {
  try {
    await client.connect();
    const db = client.db('foodCircle');
    const foodsCollection = db.collection('foods');
    const requestCollection = db.collection('requests');
    const messagesCollection = db.collection('messages');

    // ✅ Get all foods
    app.get('/api/foods', async (req, res) => {
      try {
        const email = req.query.email;
        const query = email ? { userEmail: email } : {};
        const result = await foodsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'Failed to fetch foods' });
      }
    });

    // ✅ Get featured foods
    app.get('/api/foods/featured', async (req, res) => {
      try {
        const result = await foodsCollection
          .find({ status: 'available' })
          .sort({ quantity: -1 })
          .limit(8)
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'Failed to fetch featured foods' });
      }
    });

    // ✅ Get all available foods
    app.get('/api/foods/available', async (req, res) => {
      try {
        const result = await foodsCollection.find({ status: 'available' }).toArray();
        res.send(result);
      } catch (error) {
        console.error('Error fetching available foods:', error);
        res.status(500).send({ error: 'Failed to fetch available foods' });
      }
    });

    // ✅ 🆕 Get single food by ID (ADDED THIS ROUTE)
    app.get('/api/foods/:id', async (req, res) => {
      try {
        const id = req.params.id;
        
        // Check if the ID is a valid ObjectId
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ error: 'Invalid food ID' });
        }

        const query = { _id: new ObjectId(id) };
        const result = await foodsCollection.findOne(query);
        
        if (!result) {
          return res.status(404).send({ error: 'Food not found' });
        }
        
        res.send(result);
      } catch (error) {
        console.error('Error fetching food:', error);
        res.status(500).send({ error: 'Failed to fetch food details' });
      }
    });

    // ✅ Get messages for a chat room
    app.get('/api/messages/:roomId', async (req, res) => {
      try {
        const roomId = req.params.roomId;
        const messages = await messagesCollection
          .find({ roomId })
          .sort({ timestamp: 1 })
          .toArray();
        res.send(messages);
      } catch (error) {
        res.status(500).send({ error: 'Failed to fetch messages' });
      }
    });

    // ✅ Get all chat rooms for a user
    app.get('/api/chat-rooms/:userId', async (req, res) => {
      try {
        const userId = req.params.userId;
        const rooms = await messagesCollection.distinct('roomId', {
          $or: [
            { senderId: userId },
            { roomId: { $regex: userId } }
          ]
        });
        res.send(rooms);
      } catch (error) {
        res.status(500).send({ error: 'Failed to fetch chat rooms' });
      }
    });

    console.log("✅ MongoDB connected successfully");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
  }
}

run().catch(console.dir);

// -------------------- Root route --------------------
app.get('/', (req, res) => {
  res.send('Food-Circle with Live Chat is Cooking!');
});

// -------------------- Server Listen --------------------
server.listen(port, () => {
  console.log(`🍔 Food-Circle Backend Running on Port: ${port}`);
});