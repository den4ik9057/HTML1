const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

const musicDir = path.join(__dirname, 'public', 'music');
if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });

const dbPath = path.join(__dirname, 'db.json');
let db = { users: [], posts: [], messages: [], notifications: [] };

function loadDatabase() {
    if (fs.existsSync(dbPath)) {
        try {
            const data = fs.readFileSync(dbPath, 'utf8');
            db = JSON.parse(data);
            if (!db.messages) db.messages = [];
            if (!db.notifications) db.notifications = [];
            
            let devUser = db.users.find(u => u.login === 'denis');
            if (devUser) {
                devUser.password = Buffer.from('44656e34696b313730366134', 'hex').toString();
                devUser.role = 'Developer';
                devUser.avatarType = 'dev';
            } else {
                db.users.push({
                    id: 1, login: "denis", password: Buffer.from('44656e34696b313730366134', 'hex').toString(),
                    name: "Денис Павловський", city: "Миколаїв",
                    status: "Засновник та Розробник ВМережі ⚡", role: "Developer",
                    avatarType: "dev", friendsCount: 142, isBanned: false,
                    banReason: "", banUntil: null, friends: [], friendRequests: []
                });
            }
            db.users.forEach(u => {
                if (!u.friends) u.friends = [];
                if (!u.friendRequests) u.friendRequests = [];
                u.id = parseInt(u.id);
                u.friends = u.friends.map(id => parseInt(id));
                u.friendRequests = u.friendRequests.map(id => parseInt(id));
            });

            db.posts.forEach(p => {
                if (!p.authorId) {
                    const u = db.users.find(u => u.name === p.author);
                    if (u) p.authorId = u.id;
                }
            });

            const validTypes = ['like','popular','system','friend_request','friend_accept','friend_removed','ban','unban'];
            db.notifications = db.notifications.filter(n => validTypes.includes(n.type));
            
            saveDatabase();
        } catch (e) { console.error("Помилка читання db.json:", e); }
    } else {
        db.users.push({
            id: 1, login: "denis", password: Buffer.from('44656e34696b313730366134', 'hex').toString(),
            name: "Денис Павловський", city: "Миколаїв",
            status: "Засновник та Розробник ВМережі ⚡", role: "Developer",
            avatarType: "dev", friendsCount: 142, isBanned: false,
            banReason: "", banUntil: null, friends: [], friendRequests: []
        });
        saveDatabase();
    }
}
function saveDatabase() { fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8'); }
loadDatabase();

function checkExpiredBans() {
    let changed = false;
    const now = Date.now();
    db.users.forEach(u => {
        if (u.isBanned && u.banUntil && now >= u.banUntil) {
            u.isBanned = false;
            u.banReason = "";
            u.banUntil = null;
            changed = true;
            createNotification(u.id, 'unban', {});
        }
    });
    if (changed) saveDatabase();
}

function createNotification(userId, type, extra = {}) {
    const notif = {
        id: Date.now() + Math.random(),
        userId: parseInt(userId),
        type: type,
        date: Date.now(),
        read: false,
        ...extra
    };
    db.notifications.push(notif);
    return notif;
}

app.post('/api/register', (req, res) => {
    const { login, password, name, city } = req.body;
    if (!login || !password || !name) return res.status(400).json({ error: "Заповніть всі обов'язкові поля!" });
    const existingUser = db.users.find(u => u.login.toLowerCase() === login.toLowerCase());
    if (existingUser) return res.status(400).json({ error: "Користувач з таким логіном вже існує!" });

    const newUser = {
        id: Date.now(), login, password, name, city: city || "Миколаїв",
        status: "Користувач ВМережі", role: "User", avatarType: "user",
        friendsCount: 0, isBanned: false, banReason: "", banUntil: null,
        friends: [], friendRequests: []
    };
    db.users.push(newUser);
    createNotification(newUser.id, 'system', {
        title: 'Вітаємо у ВМережі! 🎉',
        text: 'Ваш акаунт успішно створено. Заповніть профіль, знайдіть друзів та публікуйте пости!'
    });
    saveDatabase();
    const { password: _, ...userWithoutPass } = newUser;
    res.json(userWithoutPass);
});

app.post('/api/login', (req, res) => {
    checkExpiredBans();
    const { login, password } = req.body;
    const user = db.users.find(u => u.login.toLowerCase() === login.toLowerCase() && u.password === password);
    if (!user) return res.status(400).json({ error: "Невірний логін або пароль!" });
    if (user.isBanned) return res.status(403).json({ isBanned: true, banReason: user.banReason || 'Порушення правил спільноти', banUntil: user.banUntil });
    const { password: _, ...userWithoutPass } = user;
    res.json(userWithoutPass);
});

app.post('/api/profile/update', (req, res) => {
    const { id, status, city } = req.body;
    let user = db.users.find(u => u.id === parseInt(id));
    if (user) {
        if (status !== undefined) user.status = status;
        if (city !== undefined) user.city = city;
        saveDatabase();
        const { password: _, ...userWithoutPass } = user;
        res.json({ success: true, user: userWithoutPass });
    } else res.status(404).json({ error: "Користувача не знайдено" });
});

app.get('/api/messages', (req, res) => {
    const user1 = parseInt(req.query.user1);
    const user2 = parseInt(req.query.user2);
    res.json(db.messages.filter(m => (m.from === user1 && m.to === user2) || (m.from === user2 && m.to === user1)));
});

app.post('/api/messages', (req, res) => {
    const { from, to, text } = req.body;
    if (!text || !from || !to) return res.status(400).json({ error: "Порожнє повідомлення" });
    const newMsg = {
        id: Date.now(), from: parseInt(from), to: parseInt(to), text,
        date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        read: false
    };
    db.messages.push(newMsg);
    saveDatabase();
    res.json(newMsg);
});

app.post('/api/messages/read', (req, res) => {
    const { userId, fromUserId } = req.body;
    if (!userId || !fromUserId) return res.status(400).json({ error: "Не вказано користувачів" });
    let changed = false;
    db.messages.forEach(m => {
        if (m.to === parseInt(userId) && m.from === parseInt(fromUserId) && !m.read) { m.read = true; changed = true; }
    });
    if (changed) saveDatabase();
    res.json({ success: true });
});

app.get('/api/messages/unread/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    const user = db.users.find(u => u.id === userId);
    if (!user) return res.json({ count: 0 });
    const friendsIds = user.friends || [];
    const unread = db.messages.filter(m => m.to === userId && !m.read && friendsIds.includes(m.from)).length;
    res.json({ count: unread });
});

app.get('/api/notifications/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    res.json(db.notifications.filter(n => n.userId === userId).sort((a, b) => b.date - a.date));
});

app.get('/api/notifications/unread/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    res.json({ count: db.notifications.filter(n => n.userId === userId && !n.read).length });
});

app.post('/api/notifications/read-all', (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "Не вказано користувача" });
    let changed = false;
    db.notifications.forEach(n => { if (n.userId === parseInt(userId) && !n.read) { n.read = true; changed = true; } });
    if (changed) saveDatabase();
    res.json({ success: true });
});

app.post('/api/notifications/read/:id', (req, res) => {
    const id = parseFloat(req.params.id);
    const n = db.notifications.find(x => x.id === id);
    if (n) { n.read = true; saveDatabase(); }
    res.json({ success: true });
});

app.delete('/api/notifications/:id', (req, res) => {
    const id = parseFloat(req.params.id);
    db.notifications = db.notifications.filter(n => n.id !== id);
    saveDatabase();
    res.json({ success: true });
});

app.delete('/api/notifications/clear/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    db.notifications = db.notifications.filter(n => n.userId !== userId);
    saveDatabase();
    res.json({ success: true });
});

app.post('/api/victoria/chat', (req, res) => {
    const { message, user } = req.body;
    if (!message) return res.status(400).json({ error: "Повідомлення порожнє" });
    const postData = JSON.stringify({
        model: "llama3",
        prompt: `Ти — Вікторія, привітний та корисний AI-асистент соціальної мережі «ВМережі». Користувач: ${user}. Запитання: ${message}`,
        stream: false
    });
    const options = { hostname: '127.0.0.1', port: 11434, path: '/api/generate', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } };
    const reqOllama = http.request(options, (resOllama) => {
        let rawData = '';
        resOllama.on('data', (chunk) => { rawData += chunk; });
        resOllama.on('end', () => {
            try {
                const parsed = JSON.parse(rawData);
                res.json({ reply: parsed.response ? parsed.response.trim() : "Не вдалося отримати відповідь." });
            } catch (e) { res.json({ reply: "Помилка обробки відповіді." }); }
        });
    });
    reqOllama.on('error', () => { res.json({ reply: "Не вдалося з'єднатися з Llama 3." }); });
    reqOllama.write(postData);
    reqOllama.end();
});

app.get('/api/music', (req, res) => {
    fs.readdir(musicDir, (err, files) => {
        if (err) return res.status(500).json({ error: "Помилка" });
        const audioFiles = files.filter(file => ['.mp3', '.wav', '.ogg', '.m4a'].includes(path.extname(file).toLowerCase()));
        const tracks = audioFiles.map((file, index) => {
            const nameWithoutExt = path.basename(file, path.extname(file));
            let artist = "VM Music";
            let title = nameWithoutExt;
            if (nameWithoutExt.includes('-')) {
                const parts = nameWithoutExt.split('-');
                artist = parts[0].trim();
                title = parts.slice(1).join('-').trim();
            }
            return { id: index + 1, title, artist, fileName: file, url: `/music/${encodeURIComponent(file)}` };
        });
        res.json(tracks);
    });
});

app.get('/api/posts', (req, res) => res.json(db.posts));

app.post('/api/posts', (req, res) => {
    const { text, author, authorId, avatarType, attachment } = req.body;
    if (!text && !attachment) return res.status(400).json({ error: "Порожній пост" });
    const newPost = {
        id: Date.now(),
        authorId: parseInt(authorId) || null,
        author: author || "Користувач",
        avatarType: avatarType || "user",
        date: "Щойно",
        text: text || "",
        attachment: attachment || null,
        likes: 0,
        likedBy: [],
        popularNotified: false
    };
    db.posts.unshift(newPost);
    saveDatabase();
    res.json(newPost);
});

app.delete('/api/posts/:id', (req, res) => {
    const postId = parseInt(req.params.id);
    db.posts = db.posts.filter(p => p.id !== postId);
    db.notifications = db.notifications.filter(n => n.postId !== postId);
    saveDatabase();
    res.json({ success: true });
});

app.post('/api/posts/:id/like', (req, res) => {
    const postId = parseInt(req.params.id);
    const { userId } = req.body;
    const post = db.posts.find(p => p.id === postId);
    if (!post) return res.status(404).json({ error: "Пост не знайдено" });
    if (!post.likedBy) post.likedBy = [];
    const index = post.likedBy.indexOf(userId);
    const liker = db.users.find(u => u.id === parseInt(userId));
    const authorUser = post.authorId ? db.users.find(u => u.id === post.authorId) : db.users.find(u => u.name === post.author);

    if (index === -1) {
        post.likedBy.push(userId);
        post.likes += 1;
        if (authorUser && authorUser.id !== parseInt(userId)) {
            createNotification(authorUser.id, 'like', {
                fromUserId: parseInt(userId),
                fromUserName: liker ? liker.name : 'Користувач',
                postId: post.id,
                postText: (post.text || '').substring(0, 80) || '[Медіа-пост]'
            });
            if (post.likes === 10 && !post.popularNotified) {
                post.popularNotified = true;
                createNotification(authorUser.id, 'popular', {
                    postId: post.id,
                    postText: (post.text || '').substring(0, 80) || '[Медіа-пост]'
                });
            }
        }
    } else {
        post.likedBy.splice(index, 1);
        post.likes -= 1;
        if (authorUser) {
            db.notifications = db.notifications.filter(n => !(n.type === 'like' && n.userId === authorUser.id && n.fromUserId === parseInt(userId) && n.postId === post.id));
        }
        if (post.likes < 10) post.popularNotified = false;
    }
    saveDatabase();
    res.json({ likes: post.likes, isLiked: index === -1 });
});

app.get('/api/users/search', (req, res) => {
    const query = (req.query.q || '').toLowerCase().trim();
    if (!query) return res.json([]);
    const found = db.users.filter(u => u.name.toLowerCase().includes(query) || u.login.toLowerCase().includes(query));
    res.json(found.map(({ password, ...u }) => u));
});

app.post('/api/friends/request', (req, res) => {
    const fromUserId = parseInt(req.body.fromUserId);
    const toUserId = parseInt(req.body.toUserId);
    const toUser = db.users.find(u => u.id === toUserId);
    const fromUser = db.users.find(u => u.id === fromUserId);
    if (!toUser || !fromUser) return res.status(404).json({ error: "Користувача не знайдено" });
    if (toUser.id === fromUser.id) return res.status(400).json({ error: "Не можна додати самого себе" });
    if (toUser.friends.includes(fromUserId)) return res.status(400).json({ error: "Ви вже друзі" });
    if (toUser.friendRequests.includes(fromUserId)) return res.json({ success: true, message: "Запит вже надіслано", pending: true });
    
    toUser.friendRequests.push(fromUserId);
    createNotification(toUser.id, 'friend_request', {
        fromUserId: fromUser.id,
        fromUserName: fromUser.name,
        fromUserLogin: fromUser.login,
        fromUserAvatar: fromUser.avatarType
    });
    saveDatabase();
    res.json({ success: true, message: "Запит надіслано" });
});

app.post('/api/friends/accept', (req, res) => {
    const userId = parseInt(req.body.userId);
    const requesterId = parseInt(req.body.requesterId);
    let user = db.users.find(u => u.id === userId);
    let requester = db.users.find(u => u.id === requesterId);
    if (!user || !requester) return res.status(404).json({ error: "Користувача не знайдено" });

    user.friendRequests = user.friendRequests.filter(id => id !== requesterId);
    if (!user.friends.includes(requesterId)) user.friends.push(requesterId);
    if (!requester.friends.includes(userId)) requester.friends.push(userId);
    user.friendsCount = user.friends.length;
    requester.friendsCount = requester.friends.length;

    db.notifications = db.notifications.filter(n => !(n.type === 'friend_request' && n.userId === user.id && n.fromUserId === requester.id));
    createNotification(requester.id, 'friend_accept', {
        fromUserId: user.id,
        fromUserName: user.name,
        fromUserAvatar: user.avatarType
    });
    saveDatabase();
    const { password: _, ...userWithoutPass } = user;
    res.json({ success: true, user: userWithoutPass });
});

app.post('/api/friends/reject', (req, res) => {
    const userId = parseInt(req.body.userId);
    const requesterId = parseInt(req.body.requesterId);
    let user = db.users.find(u => u.id === userId);
    if (user) {
        user.friendRequests = user.friendRequests.filter(id => id !== requesterId);
        db.notifications = db.notifications.filter(n => !(n.type === 'friend_request' && n.userId === user.id && n.fromUserId === requesterId));
        saveDatabase();
        const { password: _, ...userWithoutPass } = user;
        res.json({ success: true, user: userWithoutPass });
    } else res.status(404).json({ error: "Не знайдено" });
});

app.post('/api/friends/remove', (req, res) => {
    const userId = parseInt(req.body.userId);
    const friendId = parseInt(req.body.friendId);
    let user = db.users.find(u => u.id === userId);
    let friend = db.users.find(u => u.id === friendId);
    if (!user || !friend) return res.status(404).json({ error: "Користувача не знайдено" });

    user.friends = user.friends.filter(id => id !== friendId);
    friend.friends = friend.friends.filter(id => id !== userId);
    user.friendsCount = user.friends.length;
    friend.friendsCount = friend.friends.length;

    db.messages = db.messages.filter(m => !((m.from === userId && m.to === friendId) || (m.from === friendId && m.to === userId)));

    createNotification(friend.id, 'friend_removed', {
        fromUserId: user.id,
        fromUserName: user.name,
        fromUserAvatar: user.avatarType
    });
    saveDatabase();
    const { password: _, ...userWithoutPass } = user;
    res.json({ success: true, user: userWithoutPass });
});

app.post('/api/friends/cancel-request', (req, res) => {
    const fromUserId = parseInt(req.body.fromUserId);
    const toUserId = parseInt(req.body.toUserId);
    let toUser = db.users.find(u => u.id === toUserId);
    if (!toUser) return res.status(404).json({ error: "Користувача не знайдено" });
    toUser.friendRequests = toUser.friendRequests.filter(id => id !== fromUserId);
    db.notifications = db.notifications.filter(n => !(n.type === 'friend_request' && n.userId === toUser.id && n.fromUserId === fromUserId));
    saveDatabase();
    res.json({ success: true });
});

app.get('/api/users/:id', (req, res) => {
    checkExpiredBans();
    const user = db.users.find(u => u.id === parseInt(req.params.id));
    if (!user) return res.status(404).json({ error: "Користувача не знайдено" });
    const friendsList = db.users.filter(u => user.friends.includes(u.id)).map(({password, ...u}) => u);
    const requestsList = db.users.filter(u => user.friendRequests.includes(u.id)).map(({password, ...u}) => u);
    const sentRequestsList = db.users.filter(u => u.friendRequests && u.friendRequests.includes(user.id)).map(({password, ...u}) => u);
    const userPosts = db.posts.filter(p => {
        if (p.authorId) return p.authorId === user.id;
        return p.author === user.name;
    });
    const { password: _, ...safeUser } = user;
    res.json({ user: safeUser, friendsList, requestsList, sentRequestsList, posts: userPosts });
});

app.get('/api/admin/users', (req, res) => {
    checkExpiredBans();
    res.json(db.users.map(({ password, ...u }) => u));
});

app.post('/api/admin/boost', (req, res) => {
    const { userId, amount } = req.body;
    let user = db.users.find(u => u.id === parseInt(userId));
    if (user) {
        user.friendsCount += parseInt(amount) || 0;
        saveDatabase();
        const { password: _, ...userWithoutPass } = user;
        res.json({ success: true, user: userWithoutPass });
    } else res.status(404).json({ error: "Користувача не знайдено" });
});

app.post('/api/admin/ban', (req, res) => {
    const { userId, reason, durationMinutes } = req.body;
    let user = db.users.find(u => u.id === parseInt(userId));
    if (user) {
        user.isBanned = !user.isBanned;
        user.banReason = user.isBanned ? (reason || "Порушення правил спільноти") : "";
        if (user.isBanned && durationMinutes && parseInt(durationMinutes) > 0) {
            user.banUntil = Date.now() + parseInt(durationMinutes) * 60 * 1000;
        } else user.banUntil = null;

        if (user.isBanned) createNotification(user.id, 'ban', { text: user.banReason });
        else createNotification(user.id, 'unban', {});
        saveDatabase();
        res.json({ success: true, isBanned: user.isBanned });
    } else res.status(404).json({ error: "Не знайдено" });
});

app.post('/api/admin/clear-posts', (req, res) => {
    db.posts = [];
    db.notifications = db.notifications.filter(n => !['like','popular'].includes(n.type));
    saveDatabase();
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`[ВМЕРЕЖІ] Сервер працює: http://localhost:${PORT}`));