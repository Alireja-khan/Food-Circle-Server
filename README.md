# 🍽️ FoodCircle Server

FoodCircle is a food sharing platform that allows users to donate, request, and manage food through an intuitive and secure system. This is the **backend (server-side)** portion of the project, built with **Node.js**, **Express**, and **MongoDB**. It supports the full CRUD operations and integrates with JWT authentication for secure API access.

---

## 🚀 Live Server

🌐 [Live Link](https://utter-waste.surge.sh/)  
📦 [Clint Repository](https://github.com/Alireja-khan/Food-Circle-Client)

---

## 🧠 Project Purpose

The purpose of this backend server is to:
- Handle and store all food-related data
- Manage food requests between users
- Authenticate users securely using JWT
- Perform CRUD operations via REST APIs
- Work seamlessly with the FoodCircle client

---

## 📁 Project Structure

food_circle_server/
│
├── index.js # Main Express server
├── .env # Environment variables (MongoDB URI, JWT secret)
├── package.json # Project metadata and dependencies
└── README.md # This file


---

## 📦 Dependencies Used

| Package        | Purpose                          |
|----------------|----------------------------------|
| `express`      | Web framework for handling APIs  |
| `cors`         | Allow Cross-Origin Requests      |
| `dotenv`       | Manage secret keys securely      |
| `mongodb`      | MongoDB client for database ops  |
| `jsonwebtoken` | Secure APIs using JWT auth       |

---

## 🔐 Environment Variables

Create a `.env` file in the root folder.


🧪 API Endpoints
🔹 Food Collection
Method	Endpoint	Description
GET	/foods	Get all foods (filterable by email)
GET	/foods/featured	Get 6 most available foods (by qty)
GET	/foods/available	Get foods sorted by expire date
GET	/foods/:id	Get food by ID
POST	/foods	Add a new food
PATCH	/foods/:id/status	Update food status (e.g., available/requested)
PUT	/foods/:id	Update food details
DELETE	/api/delete-food/:id	Delete a food item


| Method | Endpoint    | Description                |
| ------ | ----------- | -------------------------- |
| GET    | `/requests` | Get requests by user email |
| POST   | `/requests` | Create a new food request  |



✅ Features
🔐 Secured MongoDB using .env
🧹 Clean and modular route structure
🌍 CORS Enabled for frontend integration
🔄 Full CRUD support on food and request items


👨‍💻 Author
Ali Reja
Built with ❤️ for FoodCircle