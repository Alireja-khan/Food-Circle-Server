const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vgnu9ma.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // await client.connect(); 

        const db = client.db('foodCircle');
        const foodsCollection = db.collection('foods');
        const requestCollection = db.collection('requests');

        // ✅ GET all foods or by email
        app.get('/api/foods', async (req, res) => {
            const email = req.query.email;
            const query = email ? { userEmail: email } : {};
            const result = await foodsCollection.find(query).toArray();
            res.send(result);
        });

        // ✅ GET featured foods (sorted by quantity)
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

        // ✅ GET available foods (sorted by expire date)
        app.get('/api/foods/available', async (req, res) => {
            try {
                const result = await foodsCollection
                    .find({ status: 'available' })
                    .sort({ expireDate: 1 })
                    .toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ error: 'Failed to fetch available foods' });
            }
        });

        // ✅ GET a single food by ID
        app.get('/api/foods/:id', async (req, res) => {
            const id = req.params.id;
            const result = await foodsCollection.findOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        // ✅ POST a new food
        app.post('/api/foods', async (req, res) => {
            const newFood = req.body;
            newFood.quantity = parseInt(newFood.quantity);
            const result = await foodsCollection.insertOne(newFood);
            res.send(result);
        });

        // ✅ PATCH food status
        app.patch('/api/foods/:id/status', async (req, res) => {
            const id = req.params.id;
            const status = req.body.status;
            const result = await foodsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status } }
            );
            res.send(result);
        });

        // ✅ PUT (update) a food item
        app.put('/api/foods/:id', async (req, res) => {
            const id = req.params.id;
            const updatedFood = req.body;
            if (updatedFood.quantity) {
                updatedFood.quantity = parseInt(updatedFood.quantity);
            }
            const result = await foodsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updatedFood }
            );
            res.send(result);
        });

        // ✅ DELETE a food item
        app.delete('/api/delete-food/:id', async (req, res) => {
            const id = req.params.id; 
            const result = await foodsCollection.deleteOne({ _id: new ObjectId(id) });
            res.send({ success: result.deletedCount === 1 });
        });

        // ✅ GET user requests by email
        app.get('/api/requests', async (req, res) => {
            const email = req.query.email;
            const query = email ? { userEmail: email } : {};
            const result = await requestCollection.find(query).toArray();
            res.send(result);
        });

        // ✅ POST a new request
        app.post('/api/requests', async (req, res) => {
            const request = req.body;
            const result = await requestCollection.insertOne(request);
            res.send(result);
        });

    } finally {
        // Keep connection alive on Vercel
    }
}
run().catch(console.dir);

// Root route
app.get('/', (req, res) => {
    res.send('Food-Circle is Cooking');
});

app.listen(port, () => {
    console.log(`Food-Circle is Running on Port: ${port}`);
});
