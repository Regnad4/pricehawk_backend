notifications.js
const axios = require('axios');
const db = require('./db');
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
async function sendPushNotification(expoPushToken, title, body, data = {}) {
if (!expoPushToken) return;
try {
await axios.post(EXPO_PUSH_URL, {
to: expoPushToken,
sound: 'default',
title,
body,
data,
priority: 'high',
});
} catch (err) {
console.error('Push notification failed:', err.message);
}
}
function createNotification(productId, message, oldPrice, newPrice, pushToken =
null) {
const id = db.get('_nextNotificationId').value();
const now = new Date().toISOString();
db.get('notifications').push({
id,
product_id: productId,
message,
old_price: oldPrice,
new_price: newPrice,
is_read: 0,
created_at: now,
}).write();
db.set('_nextNotificationId', id + 1).write();
if (pushToken) {
const product = db.get('products').find({ id: productId }).value();
const name = product ? product.name : 'Product';
const drop = oldPrice && newPrice ? `$${oldPrice.toFixed(2)} ->
$${newPrice.toFixed(2)}` : `$${newPrice?.toFixed(2)}`;
sendPushNotification(pushToken, 'Price Drop Alert!', `${name}: ${drop}`, {
productId });
}
}
module.exports = { createNotification, sendPushNotification };
