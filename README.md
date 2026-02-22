# Reddit Comment Scraper

A premium full-stack web application that allows you to scrape all comments from a Reddit conversation URL and display them as formatted JSON or a numbered Plain Text list.

## ✨ Features

- 🚀 **Fast Scraping**: Recursively extracts all comments from any Reddit thread.
- 🎨 **Premium UI**: Modern dark-themed design with glassmorphism and smooth animations.
- 📋 **Multiple Views**: Toggle between detailed **JSON** (with syntax highlighting) and **Plain Text**.
- ✂️ **One-Click Copy**: Easily copy results to your clipboard.
- 📈 **Visitor Tracking**: Built-in persistent visitor counter (only visible to you).
- 📱 **Responsive**: Fully optimized for mobile and desktop screens.

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js
- **Frontend**: Vanilla HTML / CSS / JS
- **Data**: Reddit JSON API (via node-fetch)

## 🚀 Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Run the Server

```bash
npm start
```

By default, the app will be available at: [http://localhost:3000](http://localhost:3000)

## 🔐 Admin & Stats

The application tracks visitor counts in a local `stats.json` file. You can view the private statistics by navigating to:

`http://localhost:3000/admin/stats?key=admin123`

> [!TIP]
> You can change your admin secret key in `index.js` under the `/admin/stats` route.

## 📝 License

ISC
