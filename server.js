const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Parser = require('rss-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('public')); 

const server = http.createServer(app);
const io = new Server(server);
const parser = new Parser();

const GOOGLE_NEWS_UAE_URL = 'https://news.google.com/rss/search?q=UAE+(emergency+OR+NCEMA+OR+alert+OR+security)+when:7d&hl=en-AE&gl=AE&ceid=AE:en';

let latestAlerts = [];
let lastScanTime = null;

const directiveKeywords = ['take cover', 'seek shelter', 'evacuate', 'active threat'];
const incidentKeywords = ['interception', 'missile', 'debris', 'explosion', 'strike'];
const newsKeywords = ['discuss', 'meeting', 'talks', 'visit', 'president', 'summit'];

async function fetchOfficialAlerts() {
    try {
        const feed = await parser.parseURL(GOOGLE_NEWS_UAE_URL);
        
        const categorizedAlerts = feed.items.map(item => {
            const title = item.title ? item.title.toLowerCase() : '';
            let threatLevel = 'notice';
            let category = 'general';

            // 1. Identify Threat Level
            if (directiveKeywords.some(kw => title.includes(kw))) threatLevel = 'directive';
            else if (incidentKeywords.some(kw => title.includes(kw)) && !newsKeywords.some(kw => title.includes(kw))) threatLevel = 'incident';
            else if (newsKeywords.some(kw => title.includes(kw))) threatLevel = 'news';

            // 2. Assign Visual Category
            if (title.includes('drone') || title.includes('interception') || title.includes('missile')) category = 'defense';
            else if (title.includes('police') || title.includes('moi') || title.includes('security')) category = 'security';
            else if (title.includes('meeting') || title.includes('president') || title.includes('visit') || title.includes('discuss')) category = 'diplomacy';
            else if (title.includes('rain') || title.includes('weather') || title.includes('flood')) category = 'weather';

            // FIND THIS SECTION AND REPLACE IT
            return {
                title: item.title,
                link: item.link,
                pubDate: item.pubDate,
                source: item.source || 'UAE Source',
                threatLevel: threatLevel,
                category: category,
                image: item.enclosure?.url || 
                       item['media:content']?.$.url || 
                       'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=800&q=80'
            };
        });

        latestAlerts = categorizedAlerts
            .filter(item => item.threatLevel !== 'none')
            .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
            .slice(0, 15); 

        lastScanTime = new Date().toLocaleTimeString();
        io.emit('alerts_update', { alerts: latestAlerts, lastScan: lastScanTime });
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

setInterval(fetchOfficialAlerts, 300000);
io.on('connection', (socket) => socket.emit('alerts_update', { alerts: latestAlerts, lastScan: lastScanTime }));
fetchOfficialAlerts();

server.listen(3000, () => console.log(`UAE Sentinel live at http://localhost:3000`));