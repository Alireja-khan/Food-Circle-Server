const express = require('express');
const cors = require('cors');
const app = express();
const http = require('http');
const { Server } = require('socket.io');
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

// -------------------- Middleware --------------------
app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:3000", "your-production-url"],
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
  credentials: true
}));
app.use(express.json());

// -------------------- Create HTTP server and Socket.IO --------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:3000", "your-production-url"],
    methods: ["GET", "POST"],
    credentials: true
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

// -------------------- Store active users in memory --------------------
const activeUsers = new Map();
const userSocketMap = new Map();

// -------------------- Socket.IO Logic --------------------
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // ✅ User joins the application
  socket.on('user_joined', async (userData) => {
    try {
      const userInfo = {
        socketId: socket.id,
        userId: userData.userId,
        userName: userData.userName,
        userEmail: userData.userEmail,
        userImage: userData.userImage,
        joinedAt: new Date()
      };

      activeUsers.set(socket.id, userInfo);
      userSocketMap.set(userData.userId, socket.id);

      console.log(`User ${userData.userName} (${userData.userId}) joined the app`);

      // Broadcast to all other users that someone joined
      socket.broadcast.emit('user_online', {
        userId: userData.userId,
        userName: userData.userName,
        userImage: userData.userImage
      });

      // Send list of all active users to the new user
      const usersArray = Array.from(activeUsers.values()).filter(user => user.socketId !== socket.id);
      socket.emit('active_users', usersArray);

    } catch (error) {
      console.error('Error in user_joined:', error);
      socket.emit('join_error', { error: 'Failed to join application' });
    }
  });

  // ✅ Create or join a chat room
  socket.on('join_chat', async (data) => {
    try {
      const { roomId } = data;
      socket.join(roomId);
      console.log(`User ${socket.id} joined room ${roomId}`);

      // Send room ID back to client
      socket.emit('room_joined', { roomId });

    } catch (error) {
      console.error('Error in join_chat:', error);
      socket.emit('join_error', { error: 'Failed to join chat room' });
    }
  });

  // ✅ Handle sending messages
  socket.on('send_message', async (data) => {
    try {
      const db = client.db('foodCircle');
      const messagesCollection = db.collection('messages');

      const messageData = {
        roomId: data.roomId,
        senderId: data.senderId,
        senderName: data.senderName,
        senderImage: data.senderImage,
        message: data.message,
        timestamp: new Date(),
        read: false
      };

      // Save message to database
      const result = await messagesCollection.insertOne(messageData);
      messageData._id = result.insertedId;

      console.log(`Message saved to room ${data.roomId} from ${data.senderName}: ${data.message.substring(0, 50)}...`);

      // Send to all users in the room
      io.to(data.roomId).emit('receive_message', messageData);

      // Get the other user's ID from roomId
      const usersInRoom = data.roomId.split('_');
      const otherUserId = usersInRoom.find(id => id !== data.senderId);

      // Check if other user is online and send notification
      const otherUserSocketId = userSocketMap.get(otherUserId);
      if (otherUserSocketId && otherUserSocketId !== socket.id) {
        socket.to(otherUserSocketId).emit('new_message_notification', {
          roomId: data.roomId,
          senderName: data.senderName,
          message: data.message.substring(0, 100),
          timestamp: new Date()
        });
      }

    } catch (error) {
      console.error('Error saving message:', error);
      socket.emit('message_error', { error: 'Failed to send message' });
    }
  });

  // ✅ Typing indicators
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

  // ✅ Mark messages as read
  socket.on('mark_messages_read', async (data) => {
    try {
      const db = client.db('foodCircle');
      const messagesCollection = db.collection('messages');

      await messagesCollection.updateMany(
        {
          roomId: data.roomId,
          senderId: { $ne: data.userId },
          read: false
        },
        { $set: { read: true, readAt: new Date() } }
      );

      console.log(`Messages marked as read in room ${data.roomId} by user ${data.userId}`);

    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  });

  // ✅ Handle new food notifications (MOVED INSIDE THE CONNECTION BLOCK)
  socket.on('new_food_added', async (foodData) => {
    try {
      console.log(`New food added: ${foodData.foodName} by ${foodData.donorName}`);

      // Broadcast to all connected users except the one who added the food
      socket.broadcast.emit('food_notification', {
        type: 'NEW_FOOD',
        foodId: foodData._id,
        foodName: foodData.foodName,
        foodImage: foodData.foodImage,
        donorName: foodData.donorName,
        donorImage: foodData.donorImage,
        quantity: foodData.quantity,
        category: foodData.category,
        pickupLocation: foodData.pickupLocation,
        timestamp: new Date(),
        message: `${foodData.donorName} added new ${foodData.foodName}`
      });

    } catch (error) {
      console.error('Error handling food notification:', error);
    }
  });

  // ✅ Handle user disconnect
  socket.on('disconnect', () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      // Remove from mappings
      userSocketMap.delete(user.userId);

      // Notify other users that this user went offline
      socket.broadcast.emit('user_offline', {
        userId: user.userId
      });

      console.log(`User ${user.userName} (${user.userId}) disconnected`);
      activeUsers.delete(socket.id);
    }
    console.log('User disconnected:', socket.id);
  });
});

// -------------------- Global variables for database collections --------------------
let foodsCollection, requestCollection, messagesCollection, usersCollection;

// -------------------- Main Run Function --------------------
async function run() {
  try {
    await client.connect();
    const db = client.db('foodCircle');

    // Initialize collections
    foodsCollection = db.collection('foods');
    requestCollection = db.collection('requests');
    messagesCollection = db.collection('messages');
    usersCollection = db.collection('users');

    console.log("✅ MongoDB connected successfully");

    // ==================== FOOD ROUTES ====================

    // Get all foods
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

    // Get featured foods
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

    // Get all available foods
    app.get('/api/foods/available', async (req, res) => {
      try {
        const result = await foodsCollection.find({ status: 'available' }).toArray();
        res.send(result);
      } catch (error) {
        console.error('Error fetching available foods:', error);
        res.status(500).send({ error: 'Failed to fetch available foods' });
      }
    });

    // Get single food by ID
    app.get('/api/foods/:id', async (req, res) => {
      try {
        const id = req.params.id;

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

    // Add food
    app.post('/api/foods', async (req, res) => {
      try {
        const foodData = req.body;
        foodData.postedDate = new Date();
        foodData.status = 'available';

        const result = await foodsCollection.insertOne(foodData);

        // Emit notification after successful food addition
        if (result.insertedId) {
          const newFood = {
            _id: result.insertedId,
            ...foodData
          };

          // Broadcast to all connected sockets
          io.emit('food_notification', {
            type: 'NEW_FOOD',
            foodId: newFood._id,
            foodName: newFood.foodName,
            foodImage: newFood.foodImage,
            donorName: newFood.donorName,
            donorImage: newFood.donorImage,
            quantity: newFood.quantity,
            category: newFood.category,
            pickupLocation: newFood.pickupLocation,
            timestamp: new Date(),
            message: `${newFood.donorName} added new ${newFood.foodName}`
          });
        }

        res.send(result);
      } catch (error) {
        console.error('Error adding food:', error);
        res.status(500).send({ error: 'Failed to add food' });
      }
    });

    // Update food
    app.patch('/api/foods/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const updates = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ error: 'Invalid food ID' });
        }

        const result = await foodsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updates }
        );

        res.send(result);
      } catch (error) {
        console.error('Error updating food:', error);
        res.status(500).send({ error: 'Failed to update food' });
      }
    });

    // Delete food
    app.delete('/api/foods/:id', async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ error: 'Invalid food ID' });
        }

        const result = await foodsCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (error) {
        console.error('Error deleting food:', error);
        res.status(500).send({ error: 'Failed to delete food' });
      }
    });

    // ==================== FOOD EXPIRY SYSTEM ====================

    // Function to check and delete expired foods
    async function deleteExpiredFoods() {
      try {
        const today = new Date();
        const result = await foodsCollection.deleteMany({
          expireDate: { $lt: today.toISOString().split('T')[0] }
        });

        if (result.deletedCount > 0) {
          console.log(`🗑️ Auto-removed ${result.deletedCount} expired food(s)`);
        }
      } catch (error) {
        console.error('Error deleting expired foods:', error);
      }
    }

    // Run immediately on startup and then daily at midnight
    deleteExpiredFoods();
    setInterval(deleteExpiredFoods, 24 * 60 * 60 * 1000); // Run every 24 hours

    // Update available foods route to exclude foods expiring today
    app.get('/api/foods/available', async (req, res) => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const result = await foodsCollection.find({
          status: 'available',
          expireDate: { $gte: today } // Only foods expiring today or later
        }).toArray();
        res.send(result);
      } catch (error) {
        console.error('Error fetching available foods:', error);
        res.status(500).send({ error: 'Failed to fetch available foods' });
      }
    });

    // ==================== USER ROUTES ====================

    // Register user for chat system
    app.post('/api/register-user', async (req, res) => {
      try {
        const { userId, userName, userEmail, userImage } = req.body;

        await usersCollection.updateOne(
          { userId },
          {
            $set: {
              userId,
              userName,
              userEmail,
              userImage,
              lastSeen: new Date()
            }
          },
          { upsert: true }
        );

        res.send({ success: true, message: 'User registered for chat' });
      } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).send({ error: 'Failed to register user' });
      }
    });

    // Get user info by ID or email
    app.get('/api/user/:identifier', async (req, res) => {
      try {
        const { identifier } = req.params;

        const user = await usersCollection.findOne({
          $or: [
            { userId: identifier },
            { userEmail: identifier }
          ]
        });

        if (!user) {
          return res.status(404).send({ error: 'User not found' });
        }

        res.send(user);
      } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).send({ error: 'Failed to fetch user' });
      }
    });

    // ==================== CHAT ROUTES ====================

    // Get messages for a specific chat room
    app.get('/api/messages/:roomId', async (req, res) => {
      try {
        const roomId = req.params.roomId;
        const { limit = 50, skip = 0 } = req.query;

        const messages = await messagesCollection
          .find({ roomId })
          .sort({ timestamp: 1 })
          .limit(parseInt(limit))
          .skip(parseInt(skip))
          .toArray();

        res.send(messages);
      } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).send({ error: 'Failed to fetch messages' });
      }
    });

    // Mark messages as read
    app.patch('/api/messages/:roomId/read', async (req, res) => {
      try {
        const { roomId } = req.params;
        const { userId } = req.body;

        const result = await messagesCollection.updateMany(
          {
            roomId,
            senderId: { $ne: userId },
            read: false
          },
          {
            $set: {
              read: true,
              readAt: new Date()
            }
          }
        );

        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error('Error marking messages as read:', error);
        res.status(500).send({ error: 'Failed to mark messages as read' });
      }
    });

    // ✅ FIXED: Get all chat rooms for a user - ULTRA SIMPLE VERSION
    app.get('/api/chat-rooms/:userId', async (req, res) => {
      try {
        const userId = req.params.userId;
        console.log(`🔍 Fetching chat rooms for user: ${userId}`);

        // Get all messages where user is involved
        const userMessages = await messagesCollection.find({
          $or: [
            { senderId: userId },
            { roomId: { $regex: userId } }
          ]
        }).toArray();

        console.log(`📨 Found ${userMessages.length} messages for user`);

        // Group messages by roomId
        const roomsMap = new Map();

        userMessages.forEach(message => {
          const roomId = message.roomId;

          if (!roomsMap.has(roomId)) {
            // Extract other user ID from roomId
            const usersInRoom = roomId.split('_');
            const otherUserId = usersInRoom.find(id => id !== userId);

            roomsMap.set(roomId, {
              roomId,
              otherUserId,
              otherUserName: message.senderId === userId ? 'User' : message.senderName,
              otherUserImage: message.senderId === userId ? null : message.senderImage,
              messages: []
            });
          }

          roomsMap.get(roomId).messages.push(message);
        });

        // Convert to array and add last message info
        const rooms = Array.from(roomsMap.values()).map(room => {
          // Sort messages by timestamp to get the last one
          room.messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          const lastMessage = room.messages[0];

          // Count unread messages
          const unreadCount = room.messages.filter(msg =>
            msg.senderId !== userId && !msg.read
          ).length;

          return {
            roomId: room.roomId,
            otherUserId: room.otherUserId,
            otherUserName: room.otherUserName,
            otherUserImage: room.otherUserImage,
            lastMessage: lastMessage ? {
              message: lastMessage.message,
              timestamp: lastMessage.timestamp,
              senderName: lastMessage.senderName,
              senderId: lastMessage.senderId
            } : null,
            unreadCount,
            lastActivity: lastMessage?.timestamp || new Date()
          };
        });

        // Sort by last activity (newest first)
        rooms.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

        console.log(`✅ Returning ${rooms.length} chat rooms`);
        res.send(rooms);

      } catch (error) {
        console.error('💥 ERROR in /api/chat-rooms:', error);
        // Return empty array instead of error for better UX
        res.send([]);
      }
    });

    // Get user's unread message count
    app.get('/api/unread-count/:userId', async (req, res) => {
      try {
        const userId = req.params.userId;

        const unreadCount = await messagesCollection.countDocuments({
          senderId: { $ne: userId },
          read: false,
          roomId: { $regex: userId }
        });

        res.send({ unreadCount });
      } catch (error) {
        console.error('Error fetching unread count:', error);
        res.status(500).send({ error: 'Failed to fetch unread count' });
      }
    });

    // Search users for chatting
    app.get('/api/search-users', async (req, res) => {
      try {
        const searchTerm = req.query.q;
        const currentUserId = req.query.currentUserId;

        if (!searchTerm || searchTerm.length < 2) {
          return res.send([]);
        }

        // Simple search in users collection
        const users = await usersCollection.find({
          userId: { $ne: currentUserId },
          $or: [
            { userName: { $regex: searchTerm, $options: 'i' } },
            { userEmail: { $regex: searchTerm, $options: 'i' } }
          ]
        }).limit(10).toArray();

        res.send(users);
      } catch (error) {
        console.error('Error searching users:', error);
        res.status(500).send({ error: 'Failed to search users' });
      }
    });

    // ==================== DEBUG ROUTES ====================

    // Test database connection
    app.get('/api/debug/db-status', async (req, res) => {
      try {
        const collections = await client.db('foodCircle').listCollections().toArray();
        const collectionNames = collections.map(col => col.name);

        const messagesCount = await messagesCollection.countDocuments();
        const usersCount = await usersCollection.countDocuments();

        res.send({
          status: '✅ Database connected',
          collections: collectionNames,
          messagesCount,
          usersCount
        });
      } catch (error) {
        console.error('Database test failed:', error);
        res.status(500).send({ error: error.message });
      }
    });

    // Get all messages (for debugging)
    app.get('/api/debug/all-messages', async (req, res) => {
      try {
        const messages = await messagesCollection.find({}).toArray();
        res.send({
          count: messages.length,
          messages: messages
        });
      } catch (error) {
        console.error('Error fetching all messages:', error);
        res.status(500).send({ error: error.message });
      }
    });

  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
  }
}

run().catch(console.dir);

// -------------------- Root route --------------------
app.get('/', (req, res) => {
  res.send('Food-Circle with Live Chat is Cooking! 🍔💬');
});

// -------------------- Health check route --------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    activeUsers: activeUsers.size
  });
});

// -------------------- Server Listen --------------------
server.listen(port, () => {
  console.log(`🍔 Food-Circle Backend Running on Port: ${port}`);
  console.log(`💬 Socket.IO server is active`);
  console.log(`🌐 CORS enabled for frontend connections`);
});

// -------------------- Graceful shutdown --------------------
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await client.close();
  process.exit(0);
});