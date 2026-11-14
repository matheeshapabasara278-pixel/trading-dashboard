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
// The app ALWAYS uses this database (default: mintpipDB), whatever the connection string says.
// (A connection string without a database name makes MongoDB silently fall back to the "test" database.)
const MONGODB_DB = process.env.MONGODB_DB || 'mintpipDB';
const SERVER_BUILD = 'mintpipDB-v2'; // shown in the terminal and in /api/health, so you can tell which index.js is really running
console.log(`MintPip server build ${SERVER_BUILD} (target database: "${MONGODB_DB}")`);
const TRADES_COLLECTION = process.env.MONGODB_TRADES_COLLECTION || 'trades';
const ACCOUNTS_COLLECTION = process.env.MONGODB_ACCOUNTS_COLLECTION || 'accounts';
let dbPromise = null;

function connectDB() {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (!MONGODB_URI) return Promise.reject(new Error('MONGODB_URI is not configured in environment variables.'));
  if (!dbPromise) {
    dbPromise = mongoose
      .connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000, ...(MONGODB_DB ? { dbName: MONGODB_DB } : {}) })
      .then(async () => {
        // Safety net: never serve requests if we ended up in a different database (for example "test")
        if (mongoose.connection.name !== MONGODB_DB) {
          const wrong = mongoose.connection.name;
          await mongoose.disconnect();
          throw new Error(`Connected to database "${wrong}" instead of "${MONGODB_DB}". Check MONGODB_DB in your environment variables.`);
        }
        console.log(`✅ Connected to MongoDB Atlas -> database "${mongoose.connection.name}" (trades: "${TRADES_COLLECTION}", accounts: "${ACCOUNTS_COLLECTION}")`);
      })
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
    accountId: { type: String, default: '', index: true }, // funded account this trade belongs to (live trades)
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

const Trade = mongoose.models.Trade || mongoose.model('Trade', tradeSchema, TRADES_COLLECTION);

// ---------------------------------------------------------------------------
// Funded account model (rules + payouts); trades reference it through accountId
// ---------------------------------------------------------------------------
const accountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    firm: { type: String, default: '' },
    type: { type: String, default: 'Challenge' }, // Challenge | Instant | Funded
    phase: { type: String, default: 'Phase 1' },
    status: { type: String, default: 'Active' }, // Active | Passed | Breached
    startBalance: { type: Number, required: true },
    startDate: { type: String, default: '' },
    endDate: { type: String, default: '' },
    dailyLossPct: { type: Number, default: 5 },
    weeklyLossPct: { type: Number, default: 0 }, // 0 = off
    riskTargetPct: { type: Number, default: 0 }, // risk per trade, % of start balance (0 = off)
    maxLossStreak: { type: Number, default: 0 }, // warn after N losses in a row (0 = off)
    maxDDPct: { type: Number, default: 10 },
    ddType: { type: String, default: 'static' }, // static | trailing | locked
    targetPct: { type: Number, default: 0 },
    minDays: { type: Number, default: 0 },
    consistencyPct: { type: Number, default: 0 },
    profitSplit: { type: Number, default: 80 },
    fee: { type: Number, default: 0 },
    color: { type: String, default: '#6366F1' },
    payouts: [{ date: String, amount: Number }],
    fees: [{ date: String, label: String, amount: Number }] // extra fees: resets, retakes, add-ons (fee = initial challenge fee)
  },
  { timestamps: true }
);
const Account = mongoose.models.Account || mongoose.model('Account', accountSchema, ACCOUNTS_COLLECTION);

const ACCOUNT_KEYS = ['name', 'firm', 'type', 'phase', 'status', 'startBalance', 'startDate', 'endDate', 'dailyLossPct', 'weeklyLossPct', 'riskTargetPct', 'maxLossStreak', 'maxDDPct', 'ddType', 'targetPct', 'minDays', 'consistencyPct', 'profitSplit', 'fee', 'color'];
const pickAccount = (b = {}) => {
  const out = {};
  ACCOUNT_KEYS.forEach((k) => { if (b[k] !== undefined) out[k] = b[k]; });
  if (Array.isArray(b.payouts)) out.payouts = b.payouts.map((p) => ({ date: String(p.date || ''), amount: Number(p.amount) || 0 }));
  if (Array.isArray(b.fees)) out.fees = b.fees.map((f) => ({ date: String(f.date || ''), label: String(f.label || 'Fee'), amount: Number(f.amount) || 0 }));
  return out;
};

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
// Shows exactly which database / collection the app is reading and writing (open /api/health in the browser)
app.get('/api/health', ensureDb, async (req, res) => {
  try {
    const [trades, live, backtest, accounts] = await Promise.all([
      Trade.countDocuments(), Trade.countDocuments({ databaseType: 'live' }), Trade.countDocuments({ databaseType: 'backtest' }), Account.countDocuments()
    ]);
    res.json({
      success: true,
      build: SERVER_BUILD,
      database: mongoose.connection.name,
      host: mongoose.connection.host,
      collections: { trades: Trade.collection.name, accounts: Account.collection.name },
      counts: { trades, live, backtest, accounts }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
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
    if (databaseType === 'live' && !String(b.accountId || '').trim()) {
      return res.status(400).json({ success: false, error: 'Account is required for live trades.' });
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
      accountId: String(b.accountId || '').trim(),
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

    // Read it back so we only report success when the document is really stored in the database
    const stored = await Trade.findById(trade._id).lean();
    if (!stored) throw new Error('The trade was not found in the database after saving.');
    const total = await Trade.countDocuments({ databaseType });
    console.log(`💾 Trade ${trade._id} saved -> ${mongoose.connection.name}.${Trade.collection.name} (${databaseType} trades: ${total})`);

    res.status(201).json({
      success: true,
      data: trade,
      savedTo: { db: mongoose.connection.name, collection: Trade.collection.name, id: String(trade._id), total }
    });
  } catch (error) {
    console.error('Save Trade Error:', error.message);
    const status = error.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// PATCH /api/trades/:id  (edit fields from the UI; JSON or multipart. New images are ADDED to the existing ones)
app.patch('/api/trades/:id', handleUpload, ensureDb, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, error: 'Invalid trade id.' });

    const b = req.body || {};
    const update = {};
    ['pairDirection', 'session', 'fvgTap', 'smtDivergence', 'planeTarget', 'outcome', 'note', 'accountId'].forEach((k) => {
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

    const existing = await Trade.findById(id).select('databaseType screenshotUrl').lean();
    if (!existing) return res.status(404).json({ success: false, error: 'Trade not found.' });

    // Any newly attached images go to Cloudinary and are appended to the trade's existing images
    const folderBase = `mintpip/${existing.databaseType || 'live'}`;
    const beforeFiles = (req.files && req.files.beforeChart) || [];
    const afterFiles = (req.files && req.files.afterChart) || [];
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

    const newBefore = [...beforeUploads.map((r) => r.secure_url), ...splitLinks(b.beforeCharts)];
    const newAfter = [...afterUploads.map((r) => r.secure_url), ...splitLinks(b.afterCharts)];
    const newIds = [...beforeUploads, ...afterUploads].map((r) => r.public_id);

    if (!existing.screenshotUrl && (newBefore[0] || newAfter[0])) update.screenshotUrl = newBefore[0] || newAfter[0];

    const ops = { $set: update };
    const push = {};
    if (newBefore.length) push.beforeCharts = { $each: newBefore };
    if (newAfter.length) push.afterCharts = { $each: newAfter };
    if (newIds.length) push.screenshotPublicIds = { $each: newIds };
    if (Object.keys(push).length) ops.$push = push;

    const trade = await Trade.findByIdAndUpdate(id, ops, { new: true, runValidators: true }).lean();
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

// ---------------------------------------------------------------------------
// Account routes
// ---------------------------------------------------------------------------
app.get('/api/accounts', ensureDb, async (req, res) => {
  try {
    res.json(await Account.find().sort({ createdAt: 1 }).lean());
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/accounts', ensureDb, async (req, res) => {
  try {
    const account = await Account.create(pickAccount(req.body));
    res.status(201).json({ success: true, data: account });
  } catch (error) {
    res.status(error.name === 'ValidationError' ? 400 : 500).json({ success: false, error: error.message });
  }
});

app.patch('/api/accounts/:id', ensureDb, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid account id.' });
    const account = await Account.findByIdAndUpdate(req.params.id, { $set: pickAccount(req.body) }, { new: true, runValidators: true }).lean();
    if (!account) return res.status(404).json({ success: false, error: 'Account not found.' });
    res.json({ success: true, data: account });
  } catch (error) {
    res.status(error.name === 'ValidationError' ? 400 : 500).json({ success: false, error: error.message });
  }
});

app.delete('/api/accounts/:id', ensureDb, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, error: 'Invalid account id.' });
    const tradeCount = await Trade.countDocuments({ accountId: id });
    if (tradeCount > 0) {
      return res.status(409).json({ success: false, error: `This account still has ${tradeCount} trade(s). Move or delete them first.` });
    }
    const removed = await Account.findByIdAndDelete(id);
    if (!removed) return res.status(404).json({ success: false, error: 'Account not found.' });
    res.json({ success: true, id });
  } catch (error) {
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