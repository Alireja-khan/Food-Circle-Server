const express = require('express');
const cors = require('cors');
const app = express();
const http = require('http');
const { Server } = require('socket.io');
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// -------------------- Middleware --------------------
app.use(cors({
  origin: [
    "http://localhost:5173", 
    "http://localhost:3000", 
    "https://utter-waste.surge.sh"
  ],
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
  credentials: true
}));
app.use(express.json());
app.use('/uploads', express.static('uploads')); // Serve uploaded files

// -------------------- Multer Configuration for File Uploads --------------------
// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'food-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter for images only
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: fileFilter
});

// -------------------- Create HTTP server and Socket.IO --------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173", 
      "http://localhost:3000", 
      "https://utter-waste.surge.sh",
      "https://food-circle-server-9zagiegfa-alireja-khans-projects.vercel.app"
    ],
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

  // ✅ Handle new food notifications
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

    // ==================== IMAGE UPLOAD ROUTES ====================

    // Image upload endpoint
    app.post('/api/upload', upload.single('image'), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'No image file uploaded' });
        }

        // Construct the image URL
        const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

        res.json({
          success: true,
          imageUrl: imageUrl,
          filename: req.file.filename,
          message: 'Image uploaded successfully'
        });
      } catch (error) {
        console.error('Error uploading image:', error);
        res.status(500).json({ error: 'Failed to upload image' });
      }
    });

    // Delete uploaded image (optional cleanup)
    app.delete('/api/upload/:filename', async (req, res) => {
      try {
        const filename = req.params.filename;
        const filePath = path.join(__dirname, 'uploads', filename);

        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          res.json({ success: true, message: 'Image deleted successfully' });
        } else {
          res.status(404).json({ error: 'File not found' });
        }
      } catch (error) {
        console.error('Error deleting image:', error);
        res.status(500).json({ error: 'Failed to delete image' });
      }
    });

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
        const today = new Date().toISOString().split('T')[0];
        const result = await foodsCollection.find({
          status: 'available',
          expireDate: { $gte: today }
        }).toArray();
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

    // Add food with image upload support
    app.post('/api/foods', upload.single('foodImage'), async (req, res) => {
      try {
        const foodData = req.body;
        foodData.postedDate = new Date();
        foodData.status = 'available';

        // Handle image upload
        if (req.file) {
          // If image was uploaded via multer
          foodData.foodImage = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
          foodData.imageFilename = req.file.filename; // Store filename for potential deletion
        }
        // If foodImage is provided in body (URL), it will be used as is

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

    // Update food (with optional image update)
    app.patch('/api/foods/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const updates = req.body;

        console.log(`✏️ Update request for food ID: ${id}`, updates);

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid food ID' });
        }

        // Validate required fields
        const requiredFields = ['foodName', 'quantity', 'pickupLocation', 'expireDate'];
        const missingFields = requiredFields.filter(field => !updates[field]);

        if (missingFields.length > 0) {
          return res.status(400).json({
            error: 'Missing required fields',
            missingFields
          });
        }

        const result = await foodsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { ...updates, lastUpdated: new Date() } }
        );

        console.log(`✅ Food updated. Modified count: ${result.modifiedCount}`);

        if (result.modifiedCount === 0) {
          return res.status(404).json({ error: 'Food not found or no changes made' });
        }

        res.json({
          success: true,
          modifiedCount: result.modifiedCount,
          message: 'Food updated successfully'
        });

      } catch (error) {
        console.error('❌ Error updating food:', error);
        res.status(500).json({ error: 'Failed to update food', details: error.message });
      }
    });

    // Delete food (with image cleanup)
    app.delete('/api/foods/:id', async (req, res) => {
      try {
        const id = req.params.id;
        console.log(`🗑️ Delete request for food ID: ${id}`);

        if (!ObjectId.isValid(id)) {
          console.log('❌ Invalid food ID format');
          return res.status(400).json({ error: 'Invalid food ID format' });
        }

        // Get food data first to check for associated image file
        const food = await foodsCollection.findOne({ _id: new ObjectId(id) });

        if (!food) {
          console.log('❌ Food not found for deletion');
          return res.status(404).json({ error: 'Food not found' });
        }

        const result = await foodsCollection.deleteOne({ _id: new ObjectId(id) });

        // Delete associated image file if it exists in uploads folder
        if (result.deletedCount > 0 && food && food.imageFilename) {
          const filePath = path.join(__dirname, 'uploads', food.imageFilename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`✅ Deleted associated image file: ${food.imageFilename}`);
          }
        }

        console.log(`✅ Food deleted successfully. Deleted count: ${result.deletedCount}`);
        res.json({
          success: true,
          deletedCount: result.deletedCount,
          message: 'Food deleted successfully'
        });

      } catch (error) {
        console.error('❌ Error deleting food:', error);
        res.status(500).json({ error: 'Failed to delete food', details: error.message });
      }
    });



    // ==================== REQUEST ROUTES ====================

    // Create a new food request
    app.post('/api/requests', async (req, res) => {
      try {
        const requestData = req.body;
        requestData.requestDate = new Date();
        requestData.status = 'Pending'; // Pending, Approved, Rejected, Completed

        console.log('📝 Creating new food request:', requestData);

        const result = await requestCollection.insertOne(requestData);

        // Emit notification to donor
        io.emit('new_request_notification', {
          type: 'NEW_REQUEST',
          requestId: result.insertedId,
          foodName: requestData.foodName,
          requesterName: requestData.requesterName,
          requesterEmail: requestData.requesterEmail,
          donorEmail: requestData.donorEmail,
          timestamp: new Date(),
          message: `${requestData.requesterName} requested ${requestData.foodName}`
        });

        res.json({
          success: true,
          insertedId: result.insertedId,
          message: 'Food request submitted successfully'
        });

      } catch (error) {
        console.error('❌ Error creating request:', error);
        res.status(500).json({ error: 'Failed to submit request', details: error.message });
      }
    });

    // Get all requests for a specific donor
    app.get('/api/requests/donor/:donorEmail', async (req, res) => {
      try {
        const donorEmail = req.params.donorEmail;
        console.log(`📨 Fetching requests for donor: ${donorEmail}`);

        const requests = await requestCollection.find({ donorEmail }).sort({ requestDate: -1 }).toArray();

        res.json({
          success: true,
          requests: requests,
          count: requests.length
        });

      } catch (error) {
        console.error('❌ Error fetching donor requests:', error);
        res.status(500).json({ error: 'Failed to fetch requests', details: error.message });
      }
    });

    // Get all requests made by a specific user
    app.get('/api/requests/user/:userEmail', async (req, res) => {
      try {
        const userEmail = req.params.userEmail;
        console.log(`📨 Fetching requests for user: ${userEmail}`);

        const requests = await requestCollection.find({ userEmail }).sort({ requestDate: -1 }).toArray();

        res.json({
          success: true,
          requests: requests,
          count: requests.length
        });

      } catch (error) {
        console.error('❌ Error fetching user requests:', error);
        res.status(500).json({ error: 'Failed to fetch requests', details: error.message });
      }
    });

    // Get all requests (admin)
    app.get('/api/requests', async (req, res) => {
      try {
        const requests = await requestCollection.find({}).sort({ requestDate: -1 }).toArray();
        res.json({
          success: true,
          requests: requests,
          count: requests.length
        });
      } catch (error) {
        console.error('❌ Error fetching all requests:', error);
        res.status(500).json({ error: 'Failed to fetch requests', details: error.message });
      }
    });

    // Update request status
    app.patch('/api/requests/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const { status, adminNotes } = req.body;

        console.log(`✏️ Updating request ${id} to status: ${status}`);

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid request ID' });
        }

        const updateData = {
          status,
          updatedAt: new Date()
        };

        if (adminNotes) {
          updateData.adminNotes = adminNotes;
        }

        const result = await requestCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).json({ error: 'Request not found or no changes made' });
        }

        // Get the updated request to send notification
        const updatedRequest = await requestCollection.findOne({ _id: new ObjectId(id) });

        // Emit status update notification
        io.emit('request_status_updated', {
          type: 'STATUS_UPDATE',
          requestId: id,
          foodName: updatedRequest.foodName,
          status: status,
          requesterEmail: updatedRequest.userEmail,
          donorEmail: updatedRequest.donorEmail,
          timestamp: new Date(),
          message: `Your request for ${updatedRequest.foodName} has been ${status.toLowerCase()}`
        });

        res.json({
          success: true,
          modifiedCount: result.modifiedCount,
          message: `Request ${status.toLowerCase()} successfully`
        });

      } catch (error) {
        console.error('❌ Error updating request:', error);
        res.status(500).json({ error: 'Failed to update request', details: error.message });
      }
    });

    // Delete a request
    app.delete('/api/requests/:id', async (req, res) => {
      try {
        const id = req.params.id;
        console.log(`🗑️ Deleting request: ${id}`);

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid request ID' });
        }

        const result = await requestCollection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
          return res.status(404).json({ error: 'Request not found' });
        }

        res.json({
          success: true,
          deletedCount: result.deletedCount,
          message: 'Request deleted successfully'
        });

      } catch (error) {
        console.error('❌ Error deleting request:', error);
        res.status(500).json({ error: 'Failed to delete request', details: error.message });
      }
    });

    // Get request statistics for a user
    app.get('/api/requests/stats/:userEmail', async (req, res) => {
      try {
        const userEmail = req.params.userEmail;

        const totalRequests = await requestCollection.countDocuments({ userEmail });
        const pendingRequests = await requestCollection.countDocuments({
          userEmail,
          status: 'Pending'
        });
        const approvedRequests = await requestCollection.countDocuments({
          userEmail,
          status: 'Approved'
        });
        const completedRequests = await requestCollection.countDocuments({
          userEmail,
          status: 'Completed'
        });

        res.json({
          success: true,
          stats: {
            total: totalRequests,
            pending: pendingRequests,
            approved: approvedRequests,
            completed: completedRequests
          }
        });

      } catch (error) {
        console.error('❌ Error fetching request stats:', error);
        res.status(500).json({ error: 'Failed to fetch request statistics', details: error.message });
      }
    });

    // ==================== FOOD EXPIRY SYSTEM ====================

    // Function to check and delete expired foods
    async function deleteExpiredFoods() {
      try {
        const today = new Date();
        const expiredFoods = await foodsCollection.find({
          expireDate: { $lt: today.toISOString().split('T')[0] }
        }).toArray();

        // Delete associated image files
        for (const food of expiredFoods) {
          if (food.imageFilename) {
            const filePath = path.join(__dirname, 'uploads', food.imageFilename);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          }
        }

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

    // Get all chat rooms for a user
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
  res.send('Food-Circle with Image Upload & Live Chat is Cooking! 🍔💬📸');
});

// -------------------- Health check route --------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    activeUsers: activeUsers.size
  });
});

// -------------------- Error handling middleware --------------------
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
    }
  }
  res.status(500).json({ error: error.message });
});

// -------------------- Server Listen --------------------
server.listen(port, () => {
  console.log(`🍔 Food-Circle Backend Running on Port: ${port}`);
  console.log(`💬 Socket.IO server is active`);
  console.log(`📸 Image upload system is ready`);
  console.log(`🌐 CORS enabled for frontend connections`);
});

// -------------------- Graceful shutdown --------------------
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await client.close();
  process.exit(0);
});