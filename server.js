const express = require('express');
const path = require('path');
const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store leads (in production, use a database)
const leads = [];

// API: Submit lead
app.post('/api/leads', (req, res) => {
    const { name, phone, email } = req.body;
    
    if (!name || !phone || !email) {
        return res.status(400).json({ error: 'All fields required' });
    }
    
    const lead = {
        id: Date.now(),
        name,
        phone,
        email,
        timestamp: new Date().toISOString(),
        source: 'vein-vanish-ar'
    };
    
    leads.push(lead);
    console.log('New lead:', lead);
    
    res.json({ success: true, message: 'Lead captured' });
});

// API: Get leads (for admin)
app.get('/api/leads', (req, res) => {
    res.json(leads);
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', leads: leads.length });
});

// Serve the app
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`VeinVanish AR running on port ${PORT}`);
});
