db.js
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const adapter = new FileSync(path.join(__dirname, 'db.json'));
const db = low(adapter);
// Set up default structure
db.defaults({
products: [],
price_history: [],
notifications: [],
_nextNotificationId: 1,
_nextHistoryId: 1,
}).write();
module.exports = db;
