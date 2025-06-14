const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()

// middleware
app.use(cors());
app.use(express.json());







const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vgnu9ma.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const foodsCollection = client.db('foodCircle').collection('foods');
        const requestCollection = client.db('foodCircle').collection('requests');

        // Foods api

        app.get('/foods', async (req, res) => {

            const email = req.query.email;
            const query = {};
            if (email) {
                query.userEmail = email;
            }

            const cursor = foodsCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
        });


        app.get('/foods/featured', async (req, res) => {
            try {
                const query = { status: 'available' };

                const result = await foodsCollection
                    .find(query)
                    .sort({ quantity: -1 })
                    .limit(6)
                    .toArray();

                res.send(result);
            } catch (error) {
                res.status(500).send({ error: 'Failed to fetch featured foods' });
            }
        });


        app.get('/foods/available', async (req, res) => {
            try {
                const query = { status: 'available' };

                const result = await foodsCollection
                    .find(query)
                    .sort({ expireDate: 1 })
                    .toArray();

                res.send(result);
            } catch (error) {
                res.status(500).send({ error: 'Failed to fetch available foods' });
            }
        });




        app.get('/foods/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await foodsCollection.findOne(query);
            res.send(result);
        });


        app.post('/foods', async (req, res) => {
            const newFood = req.body;
            console.log(newFood);
            newFood.quantity = parseInt(newFood.quantity);
            const result = await foodsCollection.insertOne(newFood);
            res.send(result);
        });


        app.patch('/foods/:id/status', async (req, res) => {
            const id = req.params.id;
            const newStatus = req.body.status;

            const result = await foodsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status: newStatus } }
            );
            res.send(result);
        });







        app.get('/requests', async (req, res) => {
            const email = req.query.email;

            const query = {
                userEmail: email
            }

            const result = await requestCollection.find(query).toArray()
            res.send(result);
        });


        app.post('/requests', async (req, res) => {
            const request = req.body;
            console.log(request);
            const result = await requestCollection.insertOne(request);
            res.send(result);
        });




        app.delete('/api/delete-food/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await foodsCollection.deleteOne(query);

            res.send({ success: result.deletedCount === 1 });
        });



        app.put('/foods/:id', async (req, res) => {
            const id = req.params.id;
            const updatedFood = req.body;

            // if quantity is string ensure it's parsed into number
            if (updatedFood.quantity) {
                updatedFood.quantity = parseInt(updatedFood.quantity);
            }

            const filter = { _id: new ObjectId(id) };
            const updateDoc = { $set: updatedFood };

            const result = await foodsCollection.updateOne(filter, updateDoc);
            res.send(result);
        });



        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);









app.get('/', (req, res) => {
    res.send('Food-Circle is Cooking')
})

app.listen(port, () => {
    console.log(`Food-Circle is Running on Port : ${port}`)
})