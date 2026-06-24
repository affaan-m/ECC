'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const apiRoutes = require('./routes/api');
const proxyRoutes = require('./routes/proxy');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(morgan('[:date[clf]] :method :url :status :response-time ms'));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', apiRoutes);

// Proxy routes — e.g. POST /proxy/openai/v1/chat/completions
app.use('/proxy', proxyRoutes);

// Dashboard SPA fallback
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`TokenGuard running on http://localhost:${PORT}`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`  API:       http://localhost:${PORT}/api/stats`);
  console.log(`  Proxy:     http://localhost:${PORT}/proxy/<provider>/...`);
});

module.exports = app;
