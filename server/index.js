const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multer: temp storage for images uploaded from the computer (os.tmpdir() also works on Netlify)
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 20 * 1024 * 1024 } });

// PORT Variable Definition
const PORT = process.env.PORT || 5000;

// Notion API Endpoint (Supports both Backtest and Live databases via query parameter ?type=backtest or ?type=live)
app.get('/api/notion', async (req, res) => {
  try {
    const { type } = req.query; // Frontend එකෙන් එවන type එක ('backtest' හෝ 'live')

    // Dynamic Database ID Selection
    const databaseId = type === 'backtest'
      ? process.env.NOTION_BACKTEST_DATABASE_ID
      : process.env.NOTION_LIVE_DATABASE_ID;

    const notionKey = process.env.NOTION_KEY || process.env.NOTION_API_KEY;

    if (!databaseId) {
      return res.status(400).json({ 
        success: false, 
        error: `Database ID for type '${type || 'live'}' is not configured in environment variables.` 
      });
    }

    // Notion returns max 100 rows per request, so keep fetching until every trade is loaded
    let allResults = [];
    let startCursor = undefined;
    let hasMore = true;
    let pageCount = 0;

    while (hasMore && pageCount < 50) {
      const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${notionKey}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          page_size: 100,
          ...(startCursor ? { start_cursor: startCursor } : {})
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch from Notion API');
      }

      allResults = allResults.concat(data.results || []);
      hasMore = Boolean(data.has_more);
      startCursor = data.next_cursor;
      pageCount++;
    }

    res.json({ object: 'list', results: allResults, has_more: false });
  } catch (error) {
    console.error("Notion API Error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🌟 Upload a local file to Notion (Notion File Upload API) and return the file_upload id
async function uploadFileToNotion(file) {
  const notionKey = process.env.NOTION_KEY || process.env.NOTION_API_KEY;

  // Step 1: create the file upload object
  const createRes = await fetch('https://api.notion.com/v1/file_uploads', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${notionKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ filename: file.originalname, content_type: file.mimetype })
  });
  const created = await createRes.json();
  if (!createRes.ok) throw new Error(created.message || 'Failed to create Notion file upload');

  // Step 2: send the file bytes
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file.path)], { type: file.mimetype }), file.originalname);

  const sendRes = await fetch(`https://api.notion.com/v1/file_uploads/${created.id}/send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${notionKey}`,
      'Notion-Version': '2022-06-28'
    },
    body: form
  });
  const sent = await sendRes.json();
  if (!sendRes.ok) throw new Error(sent.message || 'Failed to upload file to Notion');

  return created.id;
}

// 🌟 Notion Add Trade Endpoint (POST - save new trade + uploaded images to Notion)
const uploadChartImages = upload.fields([{ name: 'beforeChart', maxCount: 10 }, { name: 'afterChart', maxCount: 10 }]);

app.post('/api/notion/add', (req, res, next) => {
  // Catch upload problems (too many / too large files ...) and return them as readable JSON instead of a blank 500
  uploadChartImages(req, res, (err) => {
    if (err) {
      console.error("Upload Error:", err.message);
      return res.status(400).json({ success: false, error: `Image upload problem: ${err.message}` });
    }
    next();
  });
}, async (req, res) => {
  try {
    const {
      databaseType, date, pairDirection, session, fvgTap,
      smtDivergence, executionRules, entryPrice, slPrice,
      planeTarget, lotSizeRisk, outcome, profitAmount,
      lossAmount, psychologicalState, note
    } = req.body;

    const splitLinks = (text) => String(text || '').split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
    const beforeLinks = splitLinks(req.body.beforeCharts);
    const afterLinks = splitLinks(req.body.afterCharts);

    const databaseId = databaseType === 'backtest'
      ? process.env.NOTION_BACKTEST_DATABASE_ID
      : process.env.NOTION_LIVE_DATABASE_ID;

    const notionKey = process.env.NOTION_KEY || process.env.NOTION_API_KEY;

    if (!databaseId) {
      return res.status(400).json({ success: false, error: "Database ID is missing." });
    }

    let rulesArray = [];
    try { rulesArray = JSON.parse(executionRules || '[]'); } catch (e) { }

    let psychArray = [];
    try { psychArray = JSON.parse(psychologicalState || '[]'); } catch (e) { }

    const properties = {
      "DATE": { date: { start: date || new Date().toISOString().split('T')[0] } },
      "PAIR & DIRECTION": { select: { name: pairDirection || 'GBP/USD - SELL' } },
      "SESSION & TIME": { select: { name: session || 'LN SILVER BULLET' } },
      "15 FVG TAP": { select: { name: fvgTap || 'YES' } },
      "SMT DIVERGENCE": { select: { name: smtDivergence || 'NO SMT' } },
      "EXECUTION RULES": { multi_select: rulesArray.map(rule => ({ name: rule })) },
      "OUTCOME": { select: { name: outcome || 'Win' } },
      "PSYCHOLOGICAL STATE": { multi_select: psychArray.map(state => ({ name: state })) },
      "LESSON / MISTALKE": { rich_text: [{ text: { content: note || "" } }] }
    };

    if (entryPrice) properties["ENTRY PRICE"] = { number: Number(parseFloat(entryPrice).toFixed(5)) };
    if (slPrice) properties["SL PRICE"] = { number: Number(parseFloat(slPrice).toFixed(5)) };
    if (planeTarget) properties["PLANE TARGET (RR & PIPS)"] = { rich_text: [{ text: { content: planeTarget } }] };
    if (lotSizeRisk) properties["LOT SIZE & RISK"] = { number: parseFloat(lotSizeRisk) };
    if (profitAmount) properties["PROFITE AMOUNT"] = { number: parseFloat(profitAmount) };
    if (lossAmount) properties["LOSS AMOUNT"] = { number: parseFloat(lossAmount) };

    // Images: every uploaded file goes to Notion's file upload API, every pasted link is added as an external file
    const buildFilesProperty = async (uploadedFiles, links, label) => {
      const uploaded = await Promise.all((uploadedFiles || []).map(async (file) => {
        const id = await uploadFileToNotion(file);
        return { name: file.originalname || label, type: "file_upload", file_upload: { id } };
      }));
      const external = links.map((url, i) => ({ name: `${label} ${i + 1}`, type: "external", external: { url } }));
      return [...uploaded, ...external];
    };

    const beforeFilesProp = await buildFilesProperty(req.files?.['beforeChart'], beforeLinks, 'Before Chart');
    if (beforeFilesProp.length > 0) properties["BEFORE CHART"] = { files: beforeFilesProp };

    const afterFilesProp = await buildFilesProperty(req.files?.['afterChart'], afterLinks, 'After Chart');
    if (afterFilesProp.length > 0) properties["AFTER CHART"] = { files: afterFilesProp };

    const notionResponse = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ parent: { database_id: databaseId }, properties })
    });

    const resultData = await notionResponse.json();

    if (!notionResponse.ok) {
      throw new Error(resultData.message || 'Failed to save trade to Notion API');
    }

    res.status(200).json({ success: true, data: resultData });
  } catch (error) {
    console.error("Notion Save Error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    // remove temp files
    if (req.files) Object.values(req.files).flat().forEach(f => fs.unlink(f.path, () => { }));
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