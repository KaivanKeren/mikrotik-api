const express = require("express");
const RouterOSAPI = require("node-routeros").RouterOSAPI;
const WebSocket = require("ws");
const cors = require("cors");

require("dotenv").config();

const app = express();
const port = 3030;

app.use(cors());

// MikroTik connection configuration
const connection = new RouterOSAPI({
  host: process.env.ROUTER_HOST,
  user: process.env.ROUTER_USER,
  password: process.env.ROUTER_PASSWORD,
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

let isConnecting = false;

async function connectMikroTik() {
  if (connection.connected) return;
  if (isConnecting) return;

  try {
    isConnecting = true;
    console.log("Connecting to MikroTik...");
    await connection.connect();
    console.log("Connected to MikroTik");
  } catch (error) {
    console.error("Error connecting to MikroTik:", error);
  } finally {
    isConnecting = false;
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

function formatUptime(uptime) {
  if (!uptime) return 0;
  // Convert RouterOS uptime format to seconds
  const parts = uptime.split(/[whms]/);
  const units = uptime.match(/[whms]/g);
  let seconds = 0;

  if (!parts || !units) return 0;

  parts.forEach((part, i) => {
    if (!part) return;
    switch (units[i]) {
      case "w":
        seconds += parseInt(part) * 7 * 24 * 3600;
        break;
      case "h":
        seconds += parseInt(part) * 3600;
        break;
      case "m":
        seconds += parseInt(part) * 60;
        break;
      case "s":
        seconds += parseInt(part);
        break;
    }
  });

  return seconds;
}

function formatBytes(bytes) {
  if (!bytes) return '0';
  return parseInt(bytes);
}

app.get("/api/users", async (req, res) => {
  try {
    await connectMikroTik();

    // Get all users
    const users = await connection.write("/ip/hotspot/user/print");

    // Get active sessions for correlation
    const activeSessions = await connection.write("/ip/hotspot/active/print");

    const formattedUsers = users.map((user) => {
      // Find active sessions for this user
      const userSessions = activeSessions.filter(
        (session) => session.user === user.name
      );

      return {
        username: user.name,
        profile: user.profile,
        uptime: formatUptime(user.uptime),
        bytesIn: formatBytes(user["bytes-in"]),
        bytesOut: formatBytes(user["bytes-out"]),
        disabled: user.disabled === "true",
        comment: user.comment || "",
        limitBytesIn: formatBytes(user["limit-bytes-in"]),
        limitBytesOut: formatBytes(user["limit-bytes-out"]),
        isOnline: userSessions.length > 0,
        activeSessions: userSessions.length,
      };
    });

    res.json(formattedUsers);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Get user details
app.get("/api/users/:username", async (req, res) => {
  try {
    await connectMikroTik();
    const username = req.params.username;

    // Get user basic info
    const user = await connection.write("/ip/hotspot/user/print", [
      "=.proplist=name,profile,uptime,bytes-in,bytes-out,disabled,comment,limit-bytes-in,limit-bytes-out,last-logged-out",
      "?name=" + username,
    ]);

    if (user.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Get active sessions
    const activeSessions = await connection.write("/ip/hotspot/active/print", [
      "?user=" + username,
    ]);

    // Get connection history
    const history = await connection.write("/ip/hotspot/host/print", [
      "?user=" + username,
    ]);

    const userDetails = {
      basicInfo: {
        username: user[0].name,
        profile: user[0].profile,
        uptime: formatUptime(user[0].uptime),
        bytesIn: formatBytes(user[0]["bytes-in"]),
        bytesOut: formatBytes(user[0]["bytes-out"]),
        disabled: user[0].disabled === "true",
        comment: user[0].comment || "",
        limitBytesIn: formatBytes(user[0]["limit-bytes-in"]),
        limitBytesOut: formatBytes(user[0]["limit-bytes-out"]),
        lastLoggedOut: user[0]["last-logged-out"] || null,
      },
      activeSessions: activeSessions.map((session) => ({
        ipAddress: session.address,
        macAddress: session["mac-address"],
        loginTime: session["login-by"],
        uptime: formatUptime(session.uptime),
        sessionId: session[".id"],
        bytesIn: formatBytes(session["bytes-in"]),
        bytesOut: formatBytes(session["bytes-out"]),
      })),
      connectionHistory: history.map((entry) => ({
        ipAddress: entry.address,
        macAddress: entry["mac-address"],
        lastSeen: entry["last-seen"],
        status: entry.status,
        host: entry.host,
        bytesIn: formatBytes(entry["bytes-in"]),
        bytesOut: formatBytes(entry["bytes-out"]),
      })),
    };

    res.json(userDetails);
  } catch (error) {
    console.error("Error fetching user details:", error);
    res.status(500).json({ error: "Failed to fetch user details" });
  }
});

// User management endpoints
// Enable/Disable user
app.post("/api/users/:username/toggle", async (req, res) => {
  try {
    await connectMikroTik();
    const username = req.params.username;

    const user = await connection.write("/ip/hotspot/user/print", [
      "?name=" + username,
    ]);

    if (user.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const currentState = user[0].disabled === "true";
    await connection.write("/ip/hotspot/user/set", [
      "=.id=" + user[0][".id"],
      "=disabled=" + !currentState,
    ]);

    res.json({ success: true, disabled: !currentState });
  } catch (error) {
    console.error("Error toggling user state:", error);
    res.status(500).json({ error: "Failed to toggle user state" });
  }
});

// Delete user
app.delete("/api/users/:username", async (req, res) => {
  try {
    await connectMikroTik();
    const username = req.params.username;

    const user = await connection.write("/ip/hotspot/user/print", [
      "?name=" + username,
    ]);

    if (user.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    await connection.write("/ip/hotspot/user/remove", [
      "=.id=" + user[0][".id"],
    ]);

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Failed to delete user" });
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
