const express = require("express");
const RouterOSAPI = require("node-routeros").RouterOSAPI;
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
const port = 3030;

app.use(cors());

// MikroTik connection configuration
const connection = new RouterOSAPI({
  host: "192.168.1.6",
  user: "user-api",
  password: "123123",
});

// WebSocket server setup
const wss = new WebSocket.Server({ port: 9090 });
const clients = new Set();

console.log("WebSocket server started on port 9090");

// Handle WebSocket connections
wss.on("connection", (ws) => {
  console.log("New WebSocket connection established");
  clients.add(ws);

  ws.on("message", (message) => {
    console.log("Received message from client:", message);
  });

  ws.on("close", () => {
    console.log("WebSocket connection closed");
    clients.delete(ws);
  });
});

async function connectMikroTik() {
  if (!connection.connected) {
    try {
      console.log("Connecting to MikroTik...");
      await connection.connect();
    } catch (error) {
      console.error("Error connecting to MikroTik:", error);
    }
  }
}

async function getAllUsers() {
  try {
    await connectMikroTik();
    const users = await connection.write("/ip/hotspot/user/print");
    return users.map((user) => ({
      username: user.name,
      profile: user.profile,
      uptime: user.uptime,
      bytesIn: user["bytes-in"],
      bytesOut: user["bytes-out"],
      disabled: user.disabled === "true",
      comment: user.comment || "",
      limitBytesIn: user["limit-bytes-in"],
      limitBytesOut: user["limit-bytes-out"],
    }));
  } catch (error) {
    console.error("Error fetching users:", error);
    return [];
  }
}

// Get user details by username
async function getUserDetails(username) {
  try {
    await connectMikroTik();
    const user = await connection.write("/ip/hotspot/user/print", [
      "=.proplist=name,profile,uptime,bytes-in,bytes-out,disabled,comment,limit-bytes-in,limit-bytes-out,last-logged-out",
      "?name=" + username,
    ]);

    if (user.length === 0) {
      return null;
    }

    // Get active sessions for the user
    const activeSessions = await connection.write("/ip/hotspot/active/print", [
      "?user=" + username,
    ]);

    // Get user's connection history
    const history = await connection.write("/ip/hotspot/host/print", [
      "?user=" + username,
    ]);

    return {
      basicInfo: {
        username: user[0].name,
        profile: user[0].profile,
        uptime: user[0].uptime,
        bytesIn: user[0]["bytes-in"],
        bytesOut: user[0]["bytes-out"],
        disabled: user[0].disabled === "true",
        comment: user[0].comment || "",
        limitBytesIn: user[0]["limit-bytes-in"],
        limitBytesOut: user[0]["limit-bytes-out"],
        lastLoggedOut: user[0]["last-logged-out"],
      },
      activeSessions: activeSessions.map((session) => ({
        ipAddress: session.address,
        macAddress: session["mac-address"],
        loginTime: session["login-by"],
        uptime: session.uptime,
        sessionId: session[".id"],
      })),
      connectionHistory: history.map((entry) => ({
        ipAddress: entry.address,
        macAddress: entry["mac-address"],
        lastSeen: entry["last-seen"],
        status: entry.status,
      })),
    };
  } catch (error) {
    console.error("Error fetching user details:", error);
    return null;
  }
}

// Get active IP addresses
async function getActiveIPs() {
  try {
    await connectMikroTik();
    const activeAddresses = await connection.write("/ip/address/print");
    const dhcpLeases = await connection.write("/ip/dhcp-server/lease/print");

    const activeIPs = new Set();

    // Add static IPs
    activeAddresses.forEach((addr) => {
      if (addr.address) {
        activeIPs.add(addr.address.split("/")[0]);
      }
    });

    // Add DHCP leases
    dhcpLeases.forEach((lease) => {
      if (lease.active_address) {
        activeIPs.add(lease.active_address);
      }
    });

    return Array.from(activeIPs);
  } catch (error) {
    console.error("Error fetching active IPs:", error);
    return [];
  }
}

async function getInterfaceBandwidth() {
  try {
    await connectMikroTik();
    const interfaces = await connection.write("/interface/print");

    const bandwidthData = await Promise.all(
      interfaces.map(async (iface) => {
        const monitor = await connection.write("/interface/monitor-traffic", [
          "=interface=" + iface.name,
          "=once",
        ]);

        return {
          interface: iface.name,
          rxBps: parseInt(monitor[0]["rx-bits-per-second"] || 0),
          txBps: parseInt(monitor[0]["tx-bits-per-second"] || 0),
        };
      })
    );

    return bandwidthData;
  } catch (error) {
    console.error("Error fetching bandwidth data:", error);
    return [];
  }
}

// Combined data function
async function getNetworkData() {
  try {
    const activeIPs = await getActiveIPs();
    const bandwidthData = await getInterfaceBandwidth();

    const usageByIP = {};
    activeIPs.forEach((ip) => {
      usageByIP[ip] = {
        rx: Math.random() * 1000000, // Simulated data - replace with actual tracking
        tx: Math.random() * 1000000, // Simulated data - replace with actual tracking
      };
    });

    return {
      interfaces: bandwidthData.map((iface) => ({
        interface: iface.interface,
        rxKbps: iface.rxBps / 1000,
        txKbps: iface.txBps / 1000,
      })),
      usageByIP,
      activeIPs: activeIPs.length,
    };
  } catch (error) {
    console.error("Error getting network data:", error);
    return { interfaces: [], usageByIP: {}, activeIPs: 0 };
  }
}

async function getAllLogs() {
  try {
    await connectMikroTik();

    const logs = await connection.write("/log/print", []); // Tanpa filter

    return logs;
  } catch (error) {
    console.error("Error fetching logs:", error);
    return [];
  }
}

app.get("/api/logs/all", async (req, res) => {
  try {
    const logs = await getAllLogs();
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

app.get("/api/users/:username", async (req, res) => {
  try {
    const userDetails = await getUserDetails(req.params.username);
    if (!userDetails) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(userDetails);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch user details" });
  }
});

// REST endpoint for initial data
app.get("/api/network-data", async (req, res) => {
  try {
    const data = await getNetworkData();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch network data" });
  }
});

// WebSocket updates
setInterval(async () => {
  try {
    const data = await getNetworkData();
    const update = {
      type: "bandwidth_update",
      data,
      timestamp: new Date().toISOString(),
    };

    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(update));
      }
    });
  } catch (error) {
    console.error("Error sending updates:", error);
  }
}, 3000);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
