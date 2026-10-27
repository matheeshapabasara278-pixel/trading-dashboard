const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// 1. Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Notion API Endpoint
app.get('/api/notion', async (req, res) => {
  try {
    const databaseId = process.env.NOTION_DATABASE_ID;
    const notionKey = process.env.NOTION_KEY;

    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        page_size: 100 // මෙන්න මෙතන page_size එක 100 දක්වා වැඩි කර දීමෙන් සියලුම ට්‍රේඩ්ස් එකවර ෆෙච් කරගත හැක
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

// Netlify function fallback
app.get('/.netlify/functions/notion', (req, res) => {
  res.redirect('/api/notion');
});

// 3. Serve index.html for all other routes (Express v5 compatible)
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

//app.listen(PORT, () => console.log(`🚀 MintPip Dashboard running on http://localhost:${PORT}`));
module.exports = app;