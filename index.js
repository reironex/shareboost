const express = require('express');
const axios = require('axios');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
app.use(express.json());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const total = new Map();

// Get all active sessions
app.get('/total', (req, res) => {
  const data = Array.from(total.values()).map((link, index) => ({
    session: index + 1,
    url: link.url,
    count: link.count,
    id: link.id,
    target: link.target,
  }));
  res.json(JSON.parse(JSON.stringify(data || [], null, 2)));
});

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API to start sharing
app.post('/api/submit', async (req, res) => {
  const { cookie, url, amount, interval } = req.body;
  if (!cookie || !url || !amount || !interval)
    return res.status(400).json({ error: 'Missing state, url, amount, or interval' });

  try {
    const cookies = await convertCookie(cookie);
    if (!cookies) {
      return res.status(400).json({ status: 500, error: 'Invalid cookies' });
    }

    await share(cookies, url, amount, interval);
    res.status(200).json({ status: 200 });
  } catch (err) {
    return res.status(500).json({ status: 500, error: err.message || err });
  }
});

// ----- ShareBoost functions -----
async function share(cookies, url, amount, interval) {
  const id = await getPostID(url);
  const accessToken = await getAccessToken(cookies);

  if (!id) throw new Error("Unable to get link id: invalid URL or private post");

  const postId = total.has(id) ? id + 1 : id;
  total.set(postId, { url, id, count: 0, target: amount });

  const headers = {
    'accept': '*/*',
    'accept-encoding': 'gzip, deflate',
    'connection': 'keep-alive',
    'content-length': '0',
    'cookie': cookies,
    'host': 'graph.facebook.com'
  };

  let sharedCount = 0;
  let timer;

  async function sharePost() {
    try {
      const response = await axios.post(
        `https://graph.facebook.com/me/feed?link=https://m.facebook.com/${id}&published=0&access_token=${accessToken}`,
        {},
        { headers }
      );

      if (response.status === 200) {
        total.set(postId, { ...total.get(postId), count: total.get(postId).count + 1 });
        sharedCount++;
      }

      if (sharedCount === amount) clearInterval(timer);
    } catch (error) {
      clearInterval(timer);
      total.delete(postId);
    }
  }

  timer = setInterval(sharePost, interval * 1000);
  setTimeout(() => {
    clearInterval(timer);
    total.delete(postId);
  }, amount * interval * 1000);
}

async function getPostID(url) {
  try {
    const response = await axios.post(
      'https://id.traodoisub.com/api.php',
      `link=${encodeURIComponent(url)}`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return response.data.id;
  } catch {
    return;
  }
}

async function getAccessToken(cookie) {
  try {
    const headers = {
      'authority': 'business.facebook.com',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.6,en;q=0.5',
      'cache-control': 'max-age=0',
      'cookie': cookie,
      'referer': 'https://www.facebook.com/',
      'upgrade-insecure-requests': '1',
    };
    const response = await axios.get('https://business.facebook.com/content_management', { headers });
    const token = response.data.match(/"accessToken":\s*"([^"]+)"/);
    return token ? token[1] : undefined;
  } catch {
    return;
  }
}

async function convertCookie(cookie) {
  return new Promise((resolve, reject) => {
    try {
      const cookies = JSON.parse(cookie);
      const sbCookie = cookies.find(c => c.key === "sb");
      if (!sbCookie) reject("Invalid appstate, provide a valid AppState");

      const sbValue = sbCookie.value;
      const data = `sb=${sbValue}; ${cookies.slice(1).map(c => `${c.key}=${c.value}`).join('; ')}`;
      resolve(data);
    } catch {
      reject("Error processing AppState, provide a valid AppState");
    }
  });
}

// ----- Start server -----
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`ShareBoost running on port ${PORT}`));
