const serverless = require('serverless-http');
const app = require('../../server/index'); // ඔයාගේ server/index.js path එක හරියටම දෙන්න

module.exports.handler = serverless(app);