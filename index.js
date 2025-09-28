const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Statik dosyaları ve görünümleri sunmak
app.use(express.static("public"));
app.use(express.static(path.join(__dirname, "views")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const USERS_FILE = "users.json";
const AVATARS_FILE = "avatars.json";

// Dosya okuma/yazma yardımcı fonksiyonu
function readJsonFile(filename, defaultData = {}) {
  try {
    if (fs.existsSync(filename)) {
      const data = fs.readFileSync(filename, "utf8");
      return JSON.parse(data || "{}");
    } else {
      fs.writeFileSync(filename, JSON.stringify(defaultData, null, 2));
      return defaultData;
    }
  } catch (e) {
    console.error(`${filename} dosyası okunurken hata:`, e);
    return defaultData;
  }
}

function writeJsonFile(filename, data) {
  try {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`${filename} dosyasına yazılırken hata:`, e);
  }
}

let users = readJsonFile(USERS_FILE);
let userAvatars = readJsonFile(AVATARS_FILE, {});

// Sabit kanalları hafızada tut
const channels = {
  1: { name: "9.Sınıflar", messages: [] },
  2: { name: "10.Sınıflar", messages: [] },
  3: { name: "AGANİGGALAR", messages: [] },
  4: { name: "12.Sınıflar Kanalı", messages: [] },
  // YENİ KANAL: Oyunlar Kanalı (Admin Kısıtlı)
  5: {
    name: "OYUNLAR KANALI",
    messages: [],
    isAdminOnly: true,
    pinnedMessage: {
      id: "pinned-1",
      text: "Bu kanal sadece admin duyuruları için ayrılmıştır. Lütfen sadece admin (@REF321) mesaj atsın.",
      time: "00:00",
      username: "System",
      isGif: false,
      isPinned: true,
    },
  },
};

// Aktif kullanıcılar (username ile socket ID'si eşleştirme)
const activeUsers = {};
const ADMIN_USERNAME = "REF321";

// İstanbul'a göre saat dilimini ayarlayan yardımcı fonksiyon
function getIstanbulTime() {
  const now = new Date();
  return now.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Istanbul",
  });
}

// BİLGİLENDİRME: Bu fonksiyon tüm kullanıcılara online ve offline listesini gönderir.
function broadcastUserList() {
  const allUsernames = Object.keys(users);
  const activeUsernames = Object.keys(activeUsers);
  io.emit("updateUsers", {
    activeUsers: activeUsernames,
    allUsers: allUsernames,
  });
}

// Giriş ve Kayıt Sayfaları (Değişiklik yok)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "login.html"));
});

app.get("/register", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "register.html"));
});

app.post("/register", (req, res) => {
  const { username, password, confirmPassword } = req.body;
  if (!username || !password) {
    return res.send(
      '<script>alert("Kullanıcı adı ve şifre boş olamaz!"); window.location.href="/register";</script>'
    );
  }
  if (password !== confirmPassword) {
    return res.send(
      '<script>alert("Şifreler eşleşmiyor!"); window.location.href="/register";</script>'
    );
  }
  if (users[username]) {
    return res.send(
      '<script>alert("Bu kullanıcı adı zaten alınmış!"); window.location.href="/register";</script>'
    );
  }

  // Admin kontrolü: REF321 admin şifresi REF123 olmalı
  if (username.toUpperCase() === ADMIN_USERNAME && password !== "REF123") {
    return res.send(
      '<script>alert("Admin hesabı için yanlış şifre!"); window.location.href="/register";</script>'
    );
  } else if (
    username.toUpperCase() === ADMIN_USERNAME &&
    password === "REF123"
  ) {
    users[ADMIN_USERNAME] = password;
  } else {
    users[username] = password;
  }

  writeJsonFile(USERS_FILE, users);
  broadcastUserList();
  res.send(
    '<script>alert("Kayıt başarılı! Giriş yapabilirsiniz."); window.location.href="/";</script>'
  );
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  const actualUsername = Object.keys(users).find(
    (u) => u.toLowerCase() === username.toLowerCase()
  );

  if (actualUsername && users[actualUsername] === password) {
    const encodedUsername = encodeURIComponent(actualUsername);
    res.redirect(`/servers?username=${encodedUsername}`);
  } else {
    res.send(
      '<script>alert("Yanlış kullanıcı adı veya şifre!"); window.location.href="/";</script>'
    );
  }
});

app.get("/servers", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "servers.html"));
});

// YENİ ROUTE: Çizim Kanalı
app.get("/drawing", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "drawing.html"));
});

// Socket.io Bağlantıları
io.on("connection", (socket) => {
  console.log("Bir kullanıcı bağlandı:", socket.id);
  let username = null;
  let isAdmin = false;

  socket.on("setUsername", (user) => {
    username = user;
    isAdmin = username.toUpperCase() === ADMIN_USERNAME;
    activeUsers[username] = socket.id;
    console.log(`${username} aktif oldu. Admin: ${isAdmin}`);
    broadcastUserList();
    socket.emit("loadAvatars", userAvatars); // Kullanıcının avatar listesini gönder
  });

  // Yeni: Avatar ayarı
  socket.on("setAvatar", (avatarUrl) => {
    if (username) {
      userAvatars[username] = avatarUrl;
      writeJsonFile(AVATARS_FILE, userAvatars);
      // Tüm kullanıcılara yeni avatarı yayınla (isteğe bağlı, şimdilik sadece yeni girenler alıyor)
      // io.emit("loadAvatars", userAvatars);
    }
  });

  socket.on("joinChannel", (channelId) => {
    if (socket.currentChannelId) {
      socket.leave(socket.currentChannelId);
    }
    socket.join(channelId);
    socket.currentChannelId = channelId;
    if (channels[channelId]) {
      socket.emit("loadMessages", {
        messages: channels[channelId].messages,
        pinnedMessage: channels[channelId].pinnedMessage, // Sabit mesajı gönder
      });
    }
  });

  socket.on("chatMessage", (msg) => {
    const channelId = socket.currentChannelId;
    if (channelId && channels[channelId] && username) {
      // Admin Kısıtlaması Kontrolü
      if (channels[channelId].isAdminOnly && !isAdmin) {
        console.log(
          `Kısıtlanmış kanala mesaj gönderme girişimi: ${username} -> ${channelId}`
        );
        return; // Admin değilse mesajı engelle
      }

      const messageData = {
        id: Date.now() + Math.random().toString(36).substring(2, 9),
        text: msg.text,
        time: getIstanbulTime(),
        username: username,
        isGif: msg.isGif || false,
      };

      channels[channelId].messages.push(messageData);
      io.to(channelId).emit("chatMessage", messageData);
    }
  });

  socket.on("deleteMessage", ({ channelId, messageId }) => {
    if (channels[channelId]) {
      const channel = channels[channelId];
      const messageToDelete = channel.messages.find(
        (msg) => msg.id === messageId
      );

      // Admin veya mesaj sahibi kontrolü
      const canDelete =
        isAdmin || (messageToDelete && messageToDelete.username === username);

      if (canDelete) {
        const initialLength = channel.messages.length;
        channel.messages = channel.messages.filter(
          (msg) => msg.id !== messageId
        );
        if (channel.messages.length < initialLength) {
          io.to(channelId).emit("messageDeleted", { messageId });
        }
      }
    }
  });

  // Çizim Kanalı için Socket Olayları
  socket.on("draw", (data) => {
    // Çizim verisini Çizim Kanalı'nda olan herkese yayınla (kendi hariç)
    socket.broadcast.emit("draw", data);
  });
  // Çizim ekranını temizleme
  socket.on("clearCanvas", () => {
    socket.broadcast.emit("clearCanvas");
  });

  socket.on("disconnect", () => {
    console.log("Bir kullanıcı ayrıldı:", socket.id);
    if (username && activeUsers[username] === socket.id) {
      delete activeUsers[username];
      console.log(`${username} ayrıldı.`);
      broadcastUserList();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor!`);
});
