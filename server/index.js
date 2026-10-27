const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
app.use(cors());
app.use(express.json());

// PORT Variable Definition
const PORT = process.env.PORT || 5000;

// Notion API Endpoint
app.get('/api/notion', async (req, res) => {
  try {
    const databaseId = process.env.NOTION_DATABASE_ID;
    const notionKey = process.env.NOTION_KEY || process.env.NOTION_API_KEY;

    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        page_size: 100
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to fetch from Notion API');
    }

    res.json(data);
  } catch (error) {
    console.error("Notion API Error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Netlify function fallback redirect
app.get('/.netlify/functions/notion', (req, res) => {
  res.redirect('/api/notion');
});

// Serve static files from client build if exists
app.use(express.static(path.join(__dirname, '../client/dist')));

// Serve index.html for all other frontend routes
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
});

// Local Development Server Listener
if (process.env.NODE_ENV !== 'production' && !process.env.NETLIFY) {
  app.listen(PORT, () => {
    console.log(`🚀 MintPip Server running locally on http://localhost:${PORT}`);
  });
}

module.exports = app;