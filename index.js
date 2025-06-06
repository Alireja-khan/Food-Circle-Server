const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.Port || 3000;

// middleware
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Food-Circle is Cooking')
})

app.listen(port, () => {
    console.log(`Food-Circle is Running on Port : ${port}` )
})