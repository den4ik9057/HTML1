process.on('uncaughtException', (err) => {
    console.error('🔴 UNCAUGHT EXCEPTION:', err.message);
    console.error(err.stack);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('🔴 UNHANDLED REJECTION:', reason);
});

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

const musicDir = path.join(__dirname, 'public', 'music');
if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });

if (!MONGODB_URI) { console.error('❌ MONGODB_URI не задан!'); process.exit(1); }

mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    maxPoolSize: 5
})
.then(() => console.log('✅ MongoDB підключено'))
.catch(err => { console.error('❌ MongoDB помилка:', err); process.exit(1); });

mongoose.connection.on('error', (err) => console.error('🔴 Mongoose error:', err.message));
mongoose.connection.on('disconnected', () => console.warn('⚠️ Mongoose disconnected'));
mongoose.connection.on('reconnected', () => console.log('✅ Mongoose reconnected'));

const userSchema = new mongoose.Schema({
    id: { type: Number, unique: true, required: true },
    login: { type: String, unique: true, required: true, lowercase: true },
    password: String,
    name: String,
    city: { type: String, default: 'Миколаїв' },
    status: { type: String, default: 'Користувач ВМережі' },
    role: { type: String, default: 'User' },
    avatarType: { type: String, default: 'user' },
    friendsCount: { type: Number, default: 0 },
    isBanned: { type: Boolean, default: false },
    banReason: { type: String, default: '' },
    banUntil: { type: Number, default: null },
    friends: [Number],
    friendRequests: [Number]
}, { timestamps: true });

const postSchema = new mongoose.Schema({
    id: { type: Number, unique: true, required: true },
    authorId: Number,
    author: String,
    avatarType: String,
    date: { type: String, default: 'Щойно' },
    text: String,
    attachment: mongoose.Schema.Types.Mixed,
    likes: { type: Number, default: 0 },
    likedBy: [Number],
    popularNotified: { type: Boolean, default: false }
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
    id: { type: Number, unique: true, required: true },
    from: Number,
    to: Number,
    text: String,
    date: String,
    read: { type: Boolean, default: false }
}, { timestamps: true });

const notificationSchema = new mongoose.Schema({
    id: { type: Number, unique: true, required: true },
    userId: Number,
    type: String,
    date: { type: Number, default: Date.now },
    read: { type: Boolean, default: false },
    fromUserId: Number,
    fromUserName: String,
    fromUserLogin: String,
    fromUserAvatar: String,
    postId: Number,
    postText: String,
    title: String,
    text: String
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Post = mongoose.model('Post', postSchema);
const Message = mongoose.model('Message', messageSchema);
const Notification = mongoose.model('Notification', notificationSchema);

async function ensureDevUser() {
    try {
        let devUser = await User.findOne({ login: 'denis' });
        const devPass = Buffer.from('44656e34696b313730366134', 'hex').toString();
        if (devUser) {
            devUser.password = devPass;
            devUser.role = 'Developer';
            devUser.avatarType = 'dev';
            await devUser.save();
        } else {
            await User.create({
                id: 1, login: 'denis', password: devPass,
                name: 'Денис Павловський', city: 'Миколаїв',
                status: 'Засновник та Розробник ВМережі ⚡', role: 'Developer',
                avatarType: 'dev', friendsCount: 142,
                isBanned: false, banReason: '', banUntil: null,
                friends: [], friendRequests: []
            });
        }
        console.log('✅ Dev-акаунт готов');
    } catch (e) { console.error('Помилка dev-акаунта:', e); }
}
mongoose.connection.once('open', ensureDevUser);

async function createNotification(userId, type, extra = {}) {
    try {
        await Notification.create({
            id: Date.now() + Math.random(),
            userId: parseInt(userId),
            type,
            date: Date.now(),
            read: false,
            ...extra
        });
    } catch (e) { console.error('Notify error:', e.message); }
}

async function checkExpiredBans() {
    try {
        const now = Date.now();
        const expired = await User.find({ isBanned: true, banUntil: { $ne: null, $lte: now } });
        for (const u of expired) {
            u.isBanned = false;
            u.banReason = '';
            u.banUntil = null;
            await u.save();
            await createNotification(u.id, 'unban', {});
        }
    } catch (e) { console.error('checkExpiredBans error:', e.message); }
}

app.post('/api/register', async (req, res) => {
    try {
        const { login, password, name, city } = req.body;
        if (!login || !password || !name) return res.status(400).json({ error: "Заповніть всі обов'язкові поля!" });
        if (login.length < 3) return res.status(400).json({ error: "Логін має бути не менше 3 символів" });
        if (password.length < 4) return res.status(400).json({ error: "Пароль має бути не менше 4 символів" });

        const existingLogin = await User.findOne({ login: login.toLowerCase() });
        if (existingLogin) return res.status(400).json({ error: "Користувач з таким логіном вже існує!" });

        const newUser = await User.create({
            id: Date.now(), login: login.toLowerCase(), password, name,
            city: city || 'Миколаїв',
            status: 'Користувач ВМережі', role: 'User', avatarType: 'user',
            friendsCount: 0, isBanned: false, friends: [], friendRequests: []
        });

        await createNotification(newUser.id, 'system', {
            title: 'Вітаємо у ВМережі! 🎉',
            text: 'Ваш акаунт успішно створено. Заповніть профіль, знайдіть друзів та публікуйте пости!'
        });

        const { password: _, ...safe } = newUser.toObject();
        res.json(safe);
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/login', async (req, res) => {
    try {
        await checkExpiredBans();
        const { login, password } = req.body;
        if (!login || !password) return res.status(400).json({ error: "Введіть логін та пароль" });

        const user = await User.findOne({ login: login.toLowerCase().trim(), password });
        if (!user) return res.status(400).json({ error: "Невірний логін або пароль!" });
        if (user.isBanned) return res.status(403).json({ isBanned: true, banReason: user.banReason || 'Порушення правил', banUntil: user.banUntil });

        const { password: _, ...safe } = user.toObject();
        res.json(safe);
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/profile/update', async (req, res) => {
    try {
        const { id, status, city } = req.body;
        const user = await User.findOne({ id: parseInt(id) });
        if (!user) return res.status(404).json({ error: "Користувача не знайдено" });
        if (status !== undefined) user.status = status;
        if (city !== undefined) user.city = city;
        await user.save();
        const { password: _, ...safe } = user.toObject();
        res.json({ success: true, user: safe });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.get('/api/messages', async (req, res) => {
    try {
        const user1 = parseInt(req.query.user1);
        const user2 = parseInt(req.query.user2);
        const msgs = await Message.find({
            $or: [{ from: user1, to: user2 }, { from: user2, to: user1 }]
        }).sort({ createdAt: 1 });
        res.json(msgs);
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/messages', async (req, res) => {
    try {
        const { from, to, text } = req.body;
        if (!text || !from || !to) return res.status(400).json({ error: "Порожнє повідомлення" });
        const newMsg = await Message.create({
            id: Date.now(), from: parseInt(from), to: parseInt(to), text,
            date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            read: false
        });
        res.json(newMsg);
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/messages/read', async (req, res) => {
    try {
        const { userId, fromUserId } = req.body;
        if (!userId || !fromUserId) return res.status(400).json({ error: "Не вказано користувачів" });
        await Message.updateMany(
            { to: parseInt(userId), from: parseInt(fromUserId), read: false },
            { $set: { read: true } }
        );
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.get('/api/messages/unread/:userId', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const user = await User.findOne({ id: userId });
        if (!user) return res.json({ count: 0 });
        const count = await Message.countDocuments({
            to: userId, read: false, from: { $in: user.friends || [] }
        });
        res.json({ count });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.get('/api/notifications/:userId', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        res.json(await Notification.find({ userId }).sort({ date: -1 }));
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.get('/api/notifications/unread/:userId', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        res.json({ count: await Notification.countDocuments({ userId, read: false }) });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/notifications/read-all', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: "Не вказано користувача" });
        await Notification.updateMany({ userId: parseInt(userId), read: false }, { $set: { read: true } });
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/notifications/read/:id', async (req, res) => {
    try {
        const id = parseFloat(req.params.id);
        await Notification.updateOne({ id }, { $set: { read: true } });
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.delete('/api/notifications/:id', async (req, res) => {
    try {
        const id = parseFloat(req.params.id);
        await Notification.deleteOne({ id });
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.delete('/api/notifications/clear/:userId', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        await Notification.deleteMany({ userId });
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/victoria/chat', async (req, res) => {
    const { message, user } = req.body;
    if (!message) return res.status(400).json({ error: "Повідомлення порожнє" });
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) return res.json({ reply: "API ключ Groq не налаштований." });

    const postData = JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
            { role: "system", content: `Ти — Вікторія, привітний та корисний AI-асистент соціальної мережі «ВМережі». Відповідай українською мовою. Користувача звати ${user}.` },
            { role: "user", content: message }
        ],
        temperature: 0.7, max_tokens: 1024
    });
    const options = {
        hostname: 'api.groq.com', port: 443,
        path: '/openai/v1/chat/completions', method: 'POST',
        headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };
    const reqGroq = https.request(options, (resGroq) => {
        let rawData = '';
        resGroq.on('data', c => rawData += c);
        resGroq.on('end', () => {
            try {
                const parsed = JSON.parse(rawData);
                if (parsed.error) return res.json({ reply: `Помилка: ${parsed.error.message}` });
                res.json({ reply: parsed.choices?.[0]?.message?.content?.trim() || "Не вдалося отримати відповідь." });
            } catch (e) { res.json({ reply: "Помилка обробки відповіді." }); }
        });
    });
    reqGroq.on('error', () => res.json({ reply: "Не вдалося з'єднатися з Groq." }));
    reqGroq.write(postData);
    reqGroq.end();
});

app.get('/api/music', (req, res) => {
    fs.readdir(musicDir, (err, files) => {
        if (err) return res.status(500).json({ error: 'Помилка' });
        const audioFiles = files.filter(f => ['.mp3', '.wav', '.ogg', '.m4a'].includes(path.extname(f).toLowerCase()));
        const tracks = audioFiles.map((file, i) => {
            const nameNoExt = path.basename(file, path.extname(file));
            let artist = 'VM Music', title = nameNoExt;
            if (nameNoExt.includes('-')) {
                const parts = nameNoExt.split('-');
                artist = parts[0].trim();
                title = parts.slice(1).join('-').trim();
            }
            return { id: i + 1, title, artist, fileName: file, url: `/music/${encodeURIComponent(file)}` };
        });
        res.json(tracks);
    });
});

app.get('/api/posts', async (req, res) => {
    try { res.json(await Post.find().sort({ createdAt: -1 })); }
    catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/posts', async (req, res) => {
    try {
        const { text, author, authorId, avatarType, attachment } = req.body;
        if (!text && !attachment) return res.status(400).json({ error: "Порожній пост" });
        const newPost = await Post.create({
            id: Date.now(), authorId: parseInt(authorId) || null,
            author: author || 'Користувач', avatarType: avatarType || 'user',
            date: 'Щойно', text: text || '', attachment: attachment || null,
            likes: 0, likedBy: [], popularNotified: false
        });
        res.json(newPost);
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.delete('/api/posts/:id', async (req, res) => {
    try {
        const postId = parseInt(req.params.id);
        await Post.deleteOne({ id: postId });
        await Notification.deleteMany({ postId });
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/posts/:id/like', async (req, res) => {
    try {
        const postId = parseInt(req.params.id);
        const { userId } = req.body;
        const post = await Post.findOne({ id: postId });
        if (!post) return res.status(404).json({ error: "Пост не знайдено" });
        if (!post.likedBy) post.likedBy = [];
        const index = post.likedBy.indexOf(userId);
        const liker = await User.findOne({ id: parseInt(userId) });
        const authorUser = post.authorId ? await User.findOne({ id: post.authorId }) : await User.findOne({ name: post.author });

        if (index === -1) {
            post.likedBy.push(userId); post.likes += 1;
            if (authorUser && authorUser.id !== parseInt(userId)) {
                await createNotification(authorUser.id, 'like', {
                    fromUserId: parseInt(userId), fromUserName: liker ? liker.name : 'Користувач',
                    postId: post.id, postText: (post.text || '').substring(0, 80) || '[Медіа-пост]'
                });
                if (post.likes === 10 && !post.popularNotified) {
                    post.popularNotified = true;
                    await createNotification(authorUser.id, 'popular', {
                        postId: post.id, postText: (post.text || '').substring(0, 80) || '[Медіа-пост]'
                    });
                }
            }
        } else {
            post.likedBy.splice(index, 1); post.likes -= 1;
            if (authorUser) await Notification.deleteMany({ type: 'like', userId: authorUser.id, fromUserId: parseInt(userId), postId: post.id });
            if (post.likes < 10) post.popularNotified = false;
        }
        await post.save();
        res.json({ likes: post.likes, isLiked: index === -1 });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.get('/api/users/search', async (req, res) => {
    try {
        const query = (req.query.q || '').toLowerCase().trim();
        if (!query) return res.json([]);
        const users = await User.find({
            $or: [{ name: { $regex: query, $options: 'i' } }, { login: { $regex: query, $options: 'i' } }]
        });
        res.json(users.map(u => { const { password, ...safe } = u.toObject(); return safe; }));
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/friends/request', async (req, res) => {
    try {
        const fromUserId = parseInt(req.body.fromUserId);
        const toUserId = parseInt(req.body.toUserId);
        const toUser = await User.findOne({ id: toUserId });
        const fromUser = await User.findOne({ id: fromUserId });
        if (!toUser || !fromUser) return res.status(404).json({ error: "Користувача не знайдено" });
        if (toUser.id === fromUser.id) return res.status(400).json({ error: "Не можна додати себе" });
        if (toUser.friends.includes(fromUserId)) return res.status(400).json({ error: "Ви вже друзі" });
        if (toUser.friendRequests.includes(fromUserId)) return res.json({ success: true, message: "Запит вже надіслано", pending: true });

        toUser.friendRequests.push(fromUserId);
        await toUser.save();
        await createNotification(toUser.id, 'friend_request', {
            fromUserId: fromUser.id, fromUserName: fromUser.name,
            fromUserLogin: fromUser.login, fromUserAvatar: fromUser.avatarType
        });
        res.json({ success: true, message: "Запит надіслано" });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/friends/accept', async (req, res) => {
    try {
        const userId = parseInt(req.body.userId);
        const requesterId = parseInt(req.body.requesterId);
        const user = await User.findOne({ id: userId });
        const requester = await User.findOne({ id: requesterId });
        if (!user || !requester) return res.status(404).json({ error: "Користувача не знайдено" });

        user.friendRequests = user.friendRequests.filter(id => id !== requesterId);
        if (!user.friends.includes(requesterId)) user.friends.push(requesterId);
        if (!requester.friends.includes(userId)) requester.friends.push(userId);
        user.friendsCount = user.friends.length;
        requester.friendsCount = requester.friends.length;
        await user.save(); await requester.save();

        await Notification.deleteMany({ type: 'friend_request', userId: user.id, fromUserId: requester.id });
        await createNotification(requester.id, 'friend_accept', {
            fromUserId: user.id, fromUserName: user.name, fromUserAvatar: user.avatarType
        });
        const { password: _, ...safe } = user.toObject();
        res.json({ success: true, user: safe });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/friends/reject', async (req, res) => {
    try {
        const userId = parseInt(req.body.userId);
        const requesterId = parseInt(req.body.requesterId);
        const user = await User.findOne({ id: userId });
        if (!user) return res.status(404).json({ error: "Не знайдено" });
        user.friendRequests = user.friendRequests.filter(id => id !== requesterId);
        await user.save();
        await Notification.deleteMany({ type: 'friend_request', userId: user.id, fromUserId: requesterId });
        const { password: _, ...safe } = user.toObject();
        res.json({ success: true, user: safe });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/friends/remove', async (req, res) => {
    try {
        const userId = parseInt(req.body.userId);
        const friendId = parseInt(req.body.friendId);
        const user = await User.findOne({ id: userId });
        const friend = await User.findOne({ id: friendId });
        if (!user || !friend) return res.status(404).json({ error: "Користувача не знайдено" });

        user.friends = user.friends.filter(id => id !== friendId);
        friend.friends = friend.friends.filter(id => id !== userId);
        user.friendsCount = user.friends.length;
        friend.friendsCount = friend.friends.length;
        await user.save(); await friend.save();

        await Message.deleteMany({ $or: [{ from: userId, to: friendId }, { from: friendId, to: userId }] });
        await createNotification(friend.id, 'friend_removed', {
            fromUserId: user.id, fromUserName: user.name, fromUserAvatar: user.avatarType
        });
        const { password: _, ...safe } = user.toObject();
        res.json({ success: true, user: safe });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/friends/cancel-request', async (req, res) => {
    try {
        const fromUserId = parseInt(req.body.fromUserId);
        const toUserId = parseInt(req.body.toUserId);
        const toUser = await User.findOne({ id: toUserId });
        if (!toUser) return res.status(404).json({ error: "Користувача не знайдено" });
        toUser.friendRequests = toUser.friendRequests.filter(id => id !== fromUserId);
        await toUser.save();
        await Notification.deleteMany({ type: 'friend_request', userId: toUser.id, fromUserId });
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.get('/api/users/:id', async (req, res) => {
    try {
        await checkExpiredBans();
        const user = await User.findOne({ id: parseInt(req.params.id) });
        if (!user) return res.status(404).json({ error: "Користувача не знайдено" });

        const friendsList = await User.find({ id: { $in: user.friends } });
        const requestsList = await User.find({ id: { $in: user.friendRequests } });
        const sentRequestsList = await User.find({ friendRequests: user.id });
        const userPosts = await Post.find({ authorId: user.id }).sort({ createdAt: -1 });

        const clean = (arr) => arr.map(u => { const { password, ...safe } = u.toObject(); return safe; });
        const { password: _, ...safeUser } = user.toObject();
        res.json({
            user: safeUser,
            friendsList: clean(friendsList),
            requestsList: clean(requestsList),
            sentRequestsList: clean(sentRequestsList),
            posts: userPosts
        });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

// ==================== ADMIN ====================

app.get('/api/admin/users', async (req, res) => {
    try {
        await checkExpiredBans();
        const adminId = parseInt(req.query.adminId);
        const admin = await User.findOne({ id: adminId });
        if (!admin || admin.role !== 'Developer') return res.status(403).json({ error: 'Немає прав' });
        const users = await User.find().sort({ createdAt: -1 });
        res.json(users.map(u => { const { password, ...safe } = u.toObject(); return safe; }));
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/admin/boost', async (req, res) => {
    try {
        const { adminId, userId, amount } = req.body;
        const admin = await User.findOne({ id: parseInt(adminId) });
        if (!admin || admin.role !== 'Developer') return res.status(403).json({ error: 'Немає прав' });
        const user = await User.findOne({ id: parseInt(userId) });
        if (!user) return res.status(404).json({ error: 'Користувача не знайдено' });
        user.friendsCount += parseInt(amount) || 0;
        if (user.friendsCount < 0) user.friendsCount = 0;
        await user.save();
        const { password: _, ...safe } = user.toObject();
        res.json({ success: true, user: safe });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/admin/ban', async (req, res) => {
    try {
        const { adminId, userId, reason, durationMinutes } = req.body;
        const admin = await User.findOne({ id: parseInt(adminId) });
        if (!admin || admin.role !== 'Developer') return res.status(403).json({ error: 'Немає прав' });
        const user = await User.findOne({ id: parseInt(userId) });
        if (!user) return res.status(404).json({ error: "Не знайдено" });
        user.isBanned = !user.isBanned;
        user.banReason = user.isBanned ? (reason || 'Порушення правил спільноти') : '';
        if (user.isBanned && durationMinutes && parseInt(durationMinutes) > 0) {
            user.banUntil = Date.now() + parseInt(durationMinutes) * 60 * 1000;
        } else user.banUntil = null;
        await user.save();
        if (user.isBanned) await createNotification(user.id, 'ban', { text: user.banReason });
        else await createNotification(user.id, 'unban', {});
        res.json({ success: true, isBanned: user.isBanned });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/admin/change-role', async (req, res) => {
    try {
        const { adminId, userId, role } = req.body;
        const admin = await User.findOne({ id: parseInt(adminId) });
        if (!admin || admin.role !== 'Developer') return res.status(403).json({ error: 'Немає прав' });
        const validRoles = ['User', 'Moderator', 'Developer'];
        if (!validRoles.includes(role)) return res.status(400).json({ error: 'Невірна роль' });
        const user = await User.findOne({ id: parseInt(userId) });
        if (!user) return res.status(404).json({ error: 'Не знайдено' });
        user.role = role;
        if (role === 'Developer') user.avatarType = 'dev';
        else if (user.avatarType === 'dev') user.avatarType = 'user';
        await user.save();
        const { password: _, ...safe } = user.toObject();
        res.json({ success: true, user: safe });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/admin/reset-password', async (req, res) => {
    try {
        const { adminId, userId, newPassword } = req.body;
        const admin = await User.findOne({ id: parseInt(adminId) });
        if (!admin || admin.role !== 'Developer') return res.status(403).json({ error: 'Немає прав' });
        if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Пароль занадто короткий' });
        const user = await User.findOne({ id: parseInt(userId) });
        if (!user) return res.status(404).json({ error: 'Не знайдено' });
        user.password = newPassword;
        await user.save();
        res.json({ success: true, newPassword });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/admin/delete-user', async (req, res) => {
    try {
        const { adminId, userId } = req.body;
        const admin = await User.findOne({ id: parseInt(adminId) });
        if (!admin || admin.role !== 'Developer') return res.status(403).json({ error: 'Немає прав' });
        const targetId = parseInt(userId);
        if (targetId === admin.id) return res.status(400).json({ error: 'Не можна видалити себе' });
        const user = await User.findOne({ id: targetId });
        if (!user) return res.status(404).json({ error: 'Не знайдено' });

        await User.updateMany({ friends: targetId }, { $pull: { friends: targetId } });
        await User.updateMany({ friendRequests: targetId }, { $pull: { friendRequests: targetId } });
        await Post.deleteMany({ authorId: targetId });
        await Message.deleteMany({ $or: [{ from: targetId }, { to: targetId }] });
        await Notification.deleteMany({ $or: [{ userId: targetId }, { fromUserId: targetId }] });
        await User.deleteOne({ id: targetId });
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.get('/api/admin/user-friends/:userId', async (req, res) => {
    try {
        const adminId = parseInt(req.query.adminId);
        const admin = await User.findOne({ id: adminId });
        if (!admin || admin.role !== 'Developer') return res.status(403).json({ error: 'Немає прав' });
        const user = await User.findOne({ id: parseInt(req.params.userId) });
        if (!user) return res.status(404).json({ error: 'Не знайдено' });
        const friends = await User.find({ id: { $in: user.friends } });
        res.json(friends.map(f => { const { password, ...safe } = f.toObject(); return safe; }));
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.get('/api/admin/posts', async (req, res) => {
    try {
        const adminId = parseInt(req.query.adminId);
        const admin = await User.findOne({ id: adminId });
        if (!admin || admin.role !== 'Developer') return res.status(403).json({ error: 'Немає прав' });
        res.json(await Post.find().sort({ createdAt: -1 }).limit(200));
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

// ==== НОВОЕ: накрутка лайков ====
app.post('/api/admin/boost-likes', async (req, res) => {
    try {
        const { adminId, postId, amount } = req.body;
        const admin = await User.findOne({ id: parseInt(adminId) });
        if (!admin || admin.role !== 'Developer') return res.status(403).json({ error: 'Немає прав' });
        const post = await Post.findOne({ id: parseInt(postId) });
        if (!post) return res.status(404).json({ error: 'Пост не знайдено' });
        const amt = parseInt(amount) || 0;
        post.likes = Math.max(0, post.likes + amt);
        if (post.likes < 10) post.popularNotified = false;
        await post.save();
        res.json({ success: true, likes: post.likes });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/admin/delete-post', async (req, res) => {
    try {
        const { adminId, postId } = req.body;
        const admin = await User.findOne({ id: parseInt(adminId) });
        if (!admin || admin.role !== 'Developer') return res.status(403).json({ error: 'Немає прав' });
        await Post.deleteOne({ id: parseInt(postId) });
        await Notification.deleteMany({ postId: parseInt(postId) });
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/admin/delete-user-posts', async (req, res) => {
    try {
        const { adminId, userId } = req.body;
        const admin = await User.findOne({ id: parseInt(adminId) });
        if (!admin || admin.role !== 'Developer') return res.status(403).json({ error: 'Немає прав' });
        const result = await Post.deleteMany({ authorId: parseInt(userId) });
        res.json({ success: true, deleted: result.deletedCount });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/admin/clear-posts', async (req, res) => {
    try {
        const { adminId } = req.body;
        const admin = await User.findOne({ id: parseInt(adminId) });
        if (!admin || admin.role !== 'Developer') return res.status(403).json({ error: 'Немає прав' });
        await Post.deleteMany({});
        await Notification.deleteMany({ type: { $in: ['like', 'popular'] } });
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/admin/broadcast', async (req, res) => {
    try {
        const { adminId, title, text } = req.body;
        const admin = await User.findOne({ id: parseInt(adminId) });
        if (!admin || admin.role !== 'Developer') return res.status(403).json({ error: 'Немає прав' });
        if (!title && !text) return res.status(400).json({ error: 'Порожнє оголошення' });
        const users = await User.find();
        let count = 0;
        for (const u of users) {
            await createNotification(u.id, 'system', {
                title: title || '📢 Системне оголошення',
                text: text || ''
            });
            count++;
        }
        res.json({ success: true, sent: count });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/admin/clear-messages', async (req, res) => {
    try {
        const { adminId } = req.body;
        const admin = await User.findOne({ id: parseInt(adminId) });
        if (!admin || admin.role !== 'Developer') return res.status(403).json({ error: 'Немає прав' });
        const result = await Message.deleteMany({});
        res.json({ success: true, deleted: result.deletedCount });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.post('/api/admin/clear-notifications', async (req, res) => {
    try {
        const { adminId } = req.body;
        const admin = await User.findOne({ id: parseInt(adminId) });
        if (!admin || admin.role !== 'Developer') return res.status(403).json({ error: 'Немає прав' });
        const result = await Notification.deleteMany({});
        res.json({ success: true, deleted: result.deletedCount });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

app.get('/api/admin/stats', async (req, res) => {
    try {
        const adminId = parseInt(req.query.adminId);
        const admin = await User.findOne({ id: adminId });
        if (!admin || admin.role !== 'Developer') return res.status(403).json({ error: 'Немає прав' });

        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const [totalUsers, totalPosts, totalMessages, totalNotifications, bannedUsers, devUsers, activeToday] = await Promise.all([
            User.countDocuments(), Post.countDocuments(), Message.countDocuments(),
            Notification.countDocuments(), User.countDocuments({ isBanned: true }),
            User.countDocuments({ role: 'Developer' }),
            User.countDocuments({ updatedAt: { $gte: new Date(dayAgo) } })
        ]);

        const topUsers = await User.find().sort({ friendsCount: -1 }).limit(5);
        const topClean = topUsers.map(u => {
            const { password, ...safe } = u.toObject();
            return { name: safe.name, login: safe.login, friendsCount: safe.friendsCount };
        });

        res.json({ totalUsers, totalPosts, totalMessages, totalNotifications, bannedUsers, devUsers, activeToday, topUsers: topClean });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Помилка сервера' }); }
});

const server = app.listen(PORT, () => console.log(`[ВМЕРЕЖІ] Сервер працює: http://localhost:${PORT}`));

process.on('SIGTERM', () => {
    console.log('⚠️ SIGTERM — graceful shutdown');
    server.close(() => {
        mongoose.connection.close(false, () => process.exit(0));
    });
});
