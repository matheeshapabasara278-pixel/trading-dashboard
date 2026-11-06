const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 5000;

// ---------------------------------------------------------------------------
// Cloudinary (set CLOUDINARY_URL, or the three variables below)
// ---------------------------------------------------------------------------
if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
} else {
  cloudinary.config({ secure: true }); // picks up CLOUDINARY_URL automatically
}

// ---------------------------------------------------------------------------
// MongoDB Atlas (connection is cached so it also works on serverless / Netlify)
// ---------------------------------------------------------------------------
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
let dbPromise = null;

function connectDB() {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (!MONGODB_URI) return Promise.reject(new Error('MONGODB_URI is not configured in environment variables.'));
  if (!dbPromise) {
    dbPromise = mongoose
      .connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 })
      .then(() => console.log('✅ Connected to MongoDB Atlas'))
      .catch((err) => { dbPromise = null; throw err; });
  }
  return dbPromise;
}

const ensureDb = async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    res.status(503).json({ success: false, error: `Database connection failed: ${err.message}` });
  }
};

// ---------------------------------------------------------------------------
// Trade model ('live' and 'backtest' trades live in one collection, split by databaseType)
// ---------------------------------------------------------------------------
const tradeSchema = new mongoose.Schema(
  {
    databaseType: { type: String, enum: ['live', 'backtest'], default: 'live', index: true },
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    pairDirection: { type: String, required: true },
    session: { type: String, default: '' },
    fvgTap: { type: String, default: '' },
    smtDivergence: { type: String, default: '' },
    executionRules: { type: [String], default: [] },
    entryPrice: { type: Number, default: null },
    slPrice: { type: Number, default: null },
    planeTarget: { type: String, default: '' },
    lotSizeRisk: { type: Number, default: null },
    outcome: { type: String, default: 'Win' },
    profitAmount: { type: Number, default: null },
    lossAmount: { type: Number, default: null },
    psychologicalState: { type: [String], default: [] },
    note: { type: String, default: '' },
    screenshotUrl: { type: String, default: '' }, // first Cloudinary secure URL
    beforeCharts: { type: [String], default: [] }, // all "before" image URLs
    afterCharts: { type: [String], default: [] }, // all "after" image URLs
    screenshotPublicIds: { type: [String], default: [], select: false } // Cloudinary ids (used on delete)
  },
  { timestamps: true }
);

const Trade = mongoose.models.Trade || mongoose.model('Trade', tradeSchema);

// ---------------------------------------------------------------------------
// Multer (memory storage -> buffer is streamed straight to Cloudinary)
// The field names MUST match the frontend FormData: beforeChart / afterChart.
// The UI allows several images per chart, so maxCount is 10 (maxCount: 1 is what
// causes "MulterError: Unexpected file field" as soon as two images are selected).
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    if (/^image\//i.test(file.mimetype)) return cb(null, true);
    cb(new Error(`"${file.originalname}" is not an image.`));
  }
});

const uploadChartImages = upload.fields([
  { name: 'beforeChart', maxCount: 10 },
  { name: 'afterChart', maxCount: 10 }
]);

const handleUpload = (req, res, next) => {
  uploadChartImages(req, res, (err) => {
    if (!err) return next();
    console.error('Upload Error:', err.message);
    let message = `Image upload problem: ${err.message}`;
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        message = `Unexpected file field "${err.field}". Allowed fields: beforeChart, afterChart (max 10 images each).`;
      } else if (err.code === 'LIMIT_FILE_SIZE') {
        message = 'One of the images is larger than 10 MB.';
      }
    }
    res.status(400).json({ success: false, error: message });
  });
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const uploadToCloudinary = (file, folder) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder, resource_type: 'image' }, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(file.buffer);
  });

const parseArray = (v) => {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch (e) { /* not JSON: fall through */ }
    return v.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
};

const parseNum = (v, digits) => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return digits ? Number(n.toFixed(digits)) : n;
};

const splitLinks = (text) =>
  String(text || '')
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter((x) => /^https?:\/\//i.test(x));

const normalizeType = (v) => (String(v || '').toLowerCase() === 'backtest' ? 'backtest' : 'live');
const normalizeDate = (v) => (v ? String(v).slice(0, 10) : new Date().toISOString().slice(0, 10));
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ success: true, db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

// GET /api/trades?type=live|backtest  -> array of trades, oldest -> newest
app.get('/api/trades', ensureDb, async (req, res) => {
  try {
    const databaseType = normalizeType(req.query.type);
    const trades = await Trade.find({ databaseType }).sort({ date: 1, createdAt: 1 }).lean();
    res.json(trades);
  } catch (error) {
    console.error('Fetch Trades Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/trades/add  (multipart/form-data: trade fields + beforeChart / afterChart files)
app.post('/api/trades/add', handleUpload, ensureDb, async (req, res) => {
  try {
    const b = req.body || {};
    const databaseType = normalizeType(b.databaseType || b.type);

    if (!b.pairDirection) {
      return res.status(400).json({ success: false, error: 'Pair & Direction is required.' });
    }

    const beforeFiles = (req.files && req.files.beforeChart) || [];
    const afterFiles = (req.files && req.files.afterChart) || [];

    // Upload every image to Cloudinary (folders contain "before" / "after" so the UI can tell them apart)
    const folderBase = `mintpip/${databaseType}`;
    let beforeUploads = [];
    let afterUploads = [];
    try {
      [beforeUploads, afterUploads] = await Promise.all([
        Promise.all(beforeFiles.map((f) => uploadToCloudinary(f, `${folderBase}/before`))),
        Promise.all(afterFiles.map((f) => uploadToCloudinary(f, `${folderBase}/after`)))
      ]);
    } catch (uploadErr) {
      console.error('Cloudinary Upload Error:', uploadErr.message);
      return res.status(502).json({ success: false, error: `Cloudinary upload failed: ${uploadErr.message}` });
    }

    const beforeCharts = [...beforeUploads.map((r) => r.secure_url), ...splitLinks(b.beforeCharts)];
    const afterCharts = [...afterUploads.map((r) => r.secure_url), ...splitLinks(b.afterCharts)];

    const trade = await Trade.create({
      databaseType,
      date: normalizeDate(b.date),
      pairDirection: b.pairDirection,
      session: b.session || '',
      fvgTap: b.fvgTap || '',
      smtDivergence: b.smtDivergence || '',
      executionRules: parseArray(b.executionRules),
      entryPrice: parseNum(b.entryPrice, 5),
      slPrice: parseNum(b.slPrice, 5),
      planeTarget: b.planeTarget || '',
      lotSizeRisk: parseNum(b.lotSizeRisk),
      outcome: b.outcome || 'Win',
      profitAmount: parseNum(b.profitAmount),
      lossAmount: parseNum(b.lossAmount),
      psychologicalState: parseArray(b.psychologicalState),
      note: b.note || '',
      screenshotUrl: beforeCharts[0] || afterCharts[0] || '',
      beforeCharts,
      afterCharts,
      screenshotPublicIds: [...beforeUploads, ...afterUploads].map((r) => r.public_id)
    });

    res.status(201).json({ success: true, data: trade });
  } catch (error) {
    console.error('Save Trade Error:', error.message);
    const status = error.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// PATCH /api/trades/:id  (edit text fields from the UI; images stay as they are)
app.patch('/api/trades/:id', ensureDb, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, error: 'Invalid trade id.' });

    const b = req.body || {};
    const update = {};
    ['pairDirection', 'session', 'fvgTap', 'smtDivergence', 'planeTarget', 'outcome', 'note'].forEach((k) => {
      if (b[k] !== undefined) update[k] = String(b[k]);
    });
    if (b.date) update.date = normalizeDate(b.date);
    if (b.executionRules !== undefined) update.executionRules = parseArray(b.executionRules);
    if (b.psychologicalState !== undefined) update.psychologicalState = parseArray(b.psychologicalState);
    if (b.entryPrice !== undefined) update.entryPrice = parseNum(b.entryPrice, 5);
    if (b.slPrice !== undefined) update.slPrice = parseNum(b.slPrice, 5);
    if (b.lotSizeRisk !== undefined) update.lotSizeRisk = parseNum(b.lotSizeRisk);
    if (b.profitAmount !== undefined) update.profitAmount = parseNum(b.profitAmount);
    if (b.lossAmount !== undefined) update.lossAmount = parseNum(b.lossAmount);

    const trade = await Trade.findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true }).lean();
    if (!trade) return res.status(404).json({ success: false, error: 'Trade not found.' });

    res.json({ success: true, data: trade });
  } catch (error) {
    console.error('Update Trade Error:', error.message);
    const status = error.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// DELETE /api/trades/:id  (removes the document and its Cloudinary images)
app.delete('/api/trades/:id', ensureDb, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, error: 'Invalid trade id.' });

    const trade = await Trade.findByIdAndDelete(id).select('+screenshotPublicIds');
    if (!trade) return res.status(404).json({ success: false, error: 'Trade not found.' });

    // Best-effort cleanup: a Cloudinary hiccup must not make the delete look failed
    const ids = trade.screenshotPublicIds || [];
    await Promise.all(ids.map((pid) => cloudinary.uploader.destroy(pid).catch((e) => console.warn('Cloudinary cleanup failed:', pid, e.message))));

    res.json({ success: true, id });
  } catch (error) {
    console.error('Delete Trade Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Netlify function fallback redirect
app.get('/.netlify/functions/trades', (req, res) => {
  res.redirect('/api/trades');
});

// Unknown API routes -> JSON 404 (instead of the frontend's index.html)
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: `API route not found: ${req.method} ${req.originalUrl}` });
});

// Serve static files from client build if exists
app.use(express.static(path.join(__dirname, '../client/dist')));

// Serve index.html for all other frontend routes
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
});

// Last-resort error handler (always JSON)
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.message);
  res.status(err.status || 500).json({ success: false, error: err.message || 'Internal server error' });
});

// Local Development Server Listener
if (process.env.NODE_ENV !== 'production' && !process.env.NETLIFY) {
  connectDB().catch((err) => console.error('Initial MongoDB connection failed:', err.message));
  app.listen(PORT, () => {
    console.log(`🚀 MintPip Server running locally on http://localhost:${PORT}`);
  });
}

module.exports = app;