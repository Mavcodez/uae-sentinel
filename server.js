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
const parser = new Parser({
    customFields: {
        item: ['media:content', 'enclosure', 'content:encoded', 'description', 'image']
    }
});

// UPDATED: Added The National and WAM (Official Emirates News Agency)
const RSS_FEEDS = [
    'https://news.google.com/rss/search?q=UAE+(emergency+OR+NCEMA+OR+alert+OR+security)+when:7d&hl=en-AE&gl=AE&ceid=AE:en',
    'https://gulfnews.com/arc/outboundfeeds/rss/category/uae/',
    'https://www.khaleejtimes.com/feed/uae',
    'https://www.thenationalnews.com/arc/outboundfeeds/rss/uae/?outputType=xml',
    'https://wam.ae/en/rss' 
];

let latestAlerts = [];
let lastScanTime = null;

const directiveKeywords = ['take cover', 'seek shelter', 'evacuate', 'active threat'];
const incidentKeywords = ['interception', 'missile', 'debris', 'explosion', 'strike'];
const newsKeywords = ['discuss', 'meeting', 'talks', 'visit', 'president', 'summit'];

// THE SUPER-VAULT (Kept exactly as it was)
const imgDict = {
    drones: [
        'https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/MQ-9_Reaper_in_flight_%282007%29.jpg/800px-MQ-9_Reaper_in_flight_%282007%29.jpg',
        'https://images.unsplash.com/photo-1551221764-106d2036c1e3?auto=format&fit=crop&w=800&q=80'
    ],
    missiles_and_defense: [
        'https://images.unsplash.com/photo-1612803613670-388435dce39c?auto=format&fit=crop&w=800&q=80', 
        'https://images.unsplash.com/photo-1508614589041-895b88991e3e?auto=format&fit=crop&w=800&q=80', 
        'https://images.unsplash.com/photo-1509656116858-a5f18cbac29f?auto=format&fit=crop&w=800&q=80'  
    ],
    alerts_and_emergencies: [
        'https://images.unsplash.com/photo-1584210452668-cb0a95de1e51?auto=format&fit=crop&w=800&q=80', 
        'https://images.unsplash.com/photo-1531642765602-5cae8bbbf285?auto=format&fit=crop&w=800&q=80'  
    ],
    diplomacy: [
        'https://images.unsplash.com/photo-1572949645841-094f3a9c4c94?auto=format&fit=crop&w=800&q=80',
        'https://images.unsplash.com/photo-1503694978374-8a2fa686963a?auto=format&fit=crop&w=800&q=80'
    ],
    police_security: [
        'https://images.unsplash.com/photo-1555921015-5532091f6026?auto=format&fit=crop&w=800&q=80',
        'https://images.unsplash.com/photo-1453873531674-2151bcd01707?auto=format&fit=crop&w=800&q=80'
    ],
    general: [
        'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=800&q=80',
        'https://images.unsplash.com/photo-1582730147924-d9260664f33b?auto=format&fit=crop&w=800&q=80',
        'https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=800&q=80'
    ]
};

// THE BRAIN (Kept exactly as it was)
function getSmartImage(title, index) {
    const t = title.toLowerCase();

    if (['drone', 'uav', 'unmanned'].some(k => t.includes(k)))
        return imgDict.drones[index % imgDict.drones.length];

    if (['missile', 'rocket', 'interception', 'interceptor', 'debris', 'strike', 'defence', 'military', 'war'].some(k => t.includes(k)))
        return imgDict.missiles_and_defense[index % imgDict.missiles_and_defense.length];

    if (['alert', 'warning', 'evacuate', 'siren', 'emergency', 'injured', 'threat', 'sounds'].some(k => t.includes(k)))
        return imgDict.alerts_and_emergencies[index % imgDict.alerts_and_emergencies.length];

    if (['trump', 'president', 'leader', 'diplomacy', 'meeting', 'summit', 'discuss'].some(k => t.includes(k)))
        return imgDict.diplomacy[index % imgDict.diplomacy.length];

    if (['police', 'arrest', 'crime', 'security', 'court', 'killed'].some(k => t.includes(k)))
        return imgDict.police_security[index % imgDict.police_security.length];

    return null; 
}

async function fetchOfficialAlerts() {
    try {
        const feedPromises = RSS_FEEDS.map(url => parser.parseURL(url).catch(() => null));
        const feeds = await Promise.all(feedPromises);
        
        let allItems = [];
        feeds.forEach(feed => {
            if (feed && feed.items) allItems = allItems.concat(feed.items);
        });

        const uniqueItemsMap = new Map();
        allItems.forEach(item => {
            const title = item.title ? item.title.toLowerCase() : '';
            if(!uniqueItemsMap.has(title)) uniqueItemsMap.set(title, item);
        });
        
        const uniqueItems = Array.from(uniqueItemsMap.values())
                                 .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
                                 .slice(0, 20); 

        const categorizedAlerts = uniqueItems.map((item, index) => {
            const title = item.title ? item.title.toLowerCase() : '';
            
            let threatLevel = 'notice';
            if (directiveKeywords.some(kw => title.includes(kw))) threatLevel = 'directive';
            else if (incidentKeywords.some(kw => title.includes(kw)) && !newsKeywords.some(kw => title.includes(kw))) threatLevel = 'incident';
            else if (newsKeywords.some(kw => title.includes(kw))) threatLevel = 'news';

            let finalImage = getSmartImage(title, index);

            if (!finalImage) {
                finalImage = item.enclosure?.url || item['media:content']?.$.url || item.image?.url;
                
                if (finalImage && (finalImage.toLowerCase().includes('logo') || finalImage.toLowerCase().includes('icon') || finalImage.endsWith('.gif'))) {
                    finalImage = null;
                }

                if (!finalImage) {
                    const htmlFields = [item['content:encoded'], item.content, item.contentSnippet, item.description];
                    for (let field of htmlFields) {
                        if (field) {
                            const imgMatch = field.match(/<img[^>]+src=["']([^"']+)["']/i);
                            if (imgMatch && imgMatch[1] && !imgMatch[1].toLowerCase().includes('logo') && !imgMatch[1].endsWith('.gif')) {
                                finalImage = imgMatch[1];
                                break;
                            }
                        }
                    }
                }
            }

            if (!finalImage) {
                finalImage = imgDict.general[index % imgDict.general.length];
            }

            // UPDATED: Added a quick check to label the new sources properly on your cards!
            let finalSource = item.creator || item.source;
            if (!finalSource) {
                if (item.link.includes('gulfnews')) finalSource = 'Gulf News';
                else if (item.link.includes('thenationalnews')) finalSource = 'The National';
                else if (item.link.includes('wam.ae')) finalSource = 'WAM News Agency';
                else finalSource = 'Khaleej/Google';
            }

            return {
                title: item.title,
                link: item.link,
                pubDate: item.pubDate,
                source: finalSource,
                threatLevel: threatLevel,
                image: finalImage
            };
        });

        latestAlerts = categorizedAlerts; 
        lastScanTime = new Date().toLocaleTimeString();
        
        io.emit('alerts_update', { alerts: latestAlerts, lastScan: lastScanTime });
    } catch (error) {
        console.error('Scraping Error:', error.message);
    }
}

// UPDATED: Now checks every 60 seconds (60000ms) instead of 3 minutes (180000ms)
setInterval(fetchOfficialAlerts, 60000); 
io.on('connection', (socket) => socket.emit('alerts_update', { alerts: latestAlerts, lastScan: lastScanTime }));
fetchOfficialAlerts();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`UAE Sentinel live on port ${PORT}`));