# 🚀 Network Traffic Backend

A **real-time network traffic monitoring API** using **Express.js**, **WebSockets**, and **MikroTik RouterOS API**. This backend provides live network statistics and active IP tracking.

## 📡 Features

- 🔗 **MikroTik RouterOS Integration** - Fetches real-time network traffic and active IPs.
- 📊 **WebSocket Streaming** - Sends live updates to clients.
- 🔥 **REST API** - Provides an endpoint for initial data retrieval.

## 🛠️ Tech Stack

- **Backend:** Express.js, WebSockets
- **Data Source:** MikroTik RouterOS
- **Protocol:** REST API & WebSockets

## 📦 Installation

1. **Clone the repository**

   ```sh
   git clone https://github.com/KaivanKeren/mikrotik-api.git
   cd mikrotik-api
   ```

2. **Install dependencies**

   ```sh
   npm install
   ```

3. **Run the server**

   ```sh
   node index.js
   ```

## ⚙️ Configuration

Modify the MikroTik connection details in `server.js`:

```js
const connection = new RouterOSAPI({
  host: "192.168.1.1",
  user: "user",
  password: "password",
});
```

Update the WebSocket port in the frontend to match the backend WebSocket server:

```ts
export const WS_URL = "ws://localhost:9090";
```

## 🔗 API Endpoints

### **GET /api/network-data**

Fetches real-time network data, including bandwidth usage and active IPs.

**Response:**

```json
{
  "interfaces": [
    {
      "interface": "ether1",
      "rxKbps": 500,
      "txKbps": 300
    }
  ],
  "usageByIP": {
    "192.168.1.11": {
      "rx": 50000,
      "tx": 30000
    }
  },
  "activeIPs": 5
}
```

## 📡 WebSocket Events

- **bandwidth\_update** - Sends live network data updates every 3 seconds.

**Example Message:**

```json
{
  "type": "bandwidth_update",
  "data": { ... },
  "timestamp": "2024-02-08T12:00:00Z"
}
```

## 🤝 Contributing

Contributions are welcome! Feel free to fork the repository, open issues, and submit pull requests.

## 📜 License

This project is licensed under the **MIT License**. See the [LICENSE](./LICENSE) file for details.

---

🚀 **Happy Coding!** 🎉