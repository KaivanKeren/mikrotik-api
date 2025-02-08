const express = require('express');
const router = express.Router();

// Function to get MikroTik users
async function getMikroTikUsers(connection) {
    try {
        if (!connection.connected) {
            await connection.connect();
        }
        
        // Get all users from MikroTik
        const users = await connection.write('/user/print');
        
        // Get active sessions
        const activeSessions = await connection.write('/user/active/print');
        
        // Process and combine user data
        const processedUsers = users.map(user => {
            const activeSession = activeSessions.find(session => session.user === user.name);
            
            return {
                name: user.name,
                group: user.group,
                lastLoggedIn: activeSession ? activeSession['when'] : null,
                isActive: !!activeSession,
                disabled: user.disabled === 'true',
                comment: user.comment || '',
                address: activeSession ? activeSession.address : null
            };
        });
        
        return processedUsers;
    } catch (error) {
        console.error('Error fetching MikroTik users:', error);
        throw error;
    }
}

// Route to get all users
router.get('/', async (req, res) => {
    try {
        const connection = req.app.locals.routerConnection;
        const users = await getMikroTikUsers(connection);
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user data' });
    }
});

// Route to get specific user details
router.get('/:username', async (req, res) => {
    try {
        const connection = req.app.locals.routerConnection;
        const users = await getMikroTikUsers(connection);
        const user = users.find(u => u.name === req.params.username);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user data' });
    }
});

// WebSocket update function for user data
async function sendUserUpdates(wss, connection) {
    try {
        const users = await getMikroTikUsers(connection);
        const update = {
            type: 'user_update',
            data: users,
            timestamp: new Date().toISOString()
        };

        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(update));
            }
        });
    } catch (error) {
        console.error('Error sending user updates:', error);
    }
}

module.exports = {
    router,
    getMikroTikUsers,
    sendUserUpdates
};