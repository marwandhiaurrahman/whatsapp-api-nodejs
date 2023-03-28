const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const { phoneNumberFormatter } = require('./helpers/formatter');
const fileUpload = require('express-fileupload');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const port = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

/**
 * BASED ON MANY QUESTIONS
 * Actually ready mentioned on the tutorials
 * 
 * The two middlewares above only handle for data json & urlencode (x-www-form-urlencoded)
 * So, we need to add extra middleware to handle form-data
 * Here we can use express-fileupload
 */
app.use(fileUpload({
  debug: false
}));

const sessions = [];
const SESSIONS_FILE = './whatsapp-sessions.json';

const createSessionsFileIfNotExists = function () {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log('Sessions file created successfully.');
    } catch (err) {
      console.log('Failed to create sessions file: ', err);
    }
  }
}
createSessionsFileIfNotExists();
const setSessionsFile = function (sessions) {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function (err) {
    if (err) {
      console.log(err);
    }
  });
}
const getSessionsFile = function () {
  return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}

const createSession = function (id, description, webhook) {
  console.log('Creating session: ' + id);
  const client = new Client({
    restartOnAuthFail: true,
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // <- this one doesn't works in Windows
        '--disable-gpu'
      ],
    },
    authStrategy: new LocalAuth({
      clientId: id
    })
  });

  client.initialize();

  client.on('loading_screen', (percent, message) => {
    console.log(id + ' LOADING SCREEN', percent, message);
    io.emit('message', { id: id, text: 'Load chat ' + percent + '% ' + message });
  });

  client.on('qr', (qr) => {
    // console.log(id + ' QR RECEIVED', qr);
    qrcode.toDataURL(qr, (err, url) => {
      io.emit('qr', { id: id, src: url });
      io.emit('message', { id: id, text: 'QR Code received, scan please!' });
    });
  });

  client.on('ready', () => {
    console.log(id + ' READY');
    io.emit('ready', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is ready!' });

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions[sessionIndex].ready = true;
    setSessionsFile(savedSessions);
  });

  client.on('authenticated', () => {
    console.log(id + ' AUTHENTICATED');
    io.emit('authenticated', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is authenticated!' });
  });

  client.on('auth_failure', function () {
    io.emit('message', { id: id, text: 'Auth failure, restarting...' });
  });

  client.on('message', msg => {
    io.emit('message', { id: id, text: 'Message ' + msg.type + ' from ' + msg.from + ' body ' + msg.body });
    if (!msg.isStatus) {
      if (["chat", "list_response", "buttons_response"].includes(msg.type)) {
        // get webhook from json
        const savedSessions = getSessionsFile();
        const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
        var webhook = savedSessions[sessionIndex].webhook;
        if (webhook) {
          // send weebhook
          axios({
            method: 'post',
            url: webhook,
            data: {
              chatid: msg.id,
              number: msg.from,
              message: msg.body,
              timestamp: msg.timestamp,
            }
          })
            .catch(async error => {
              console.log('WEBHOOK ERROR : ' + error + 'body : ' + msg.body);
              io.emit('message', { id: id, text: 'WEBHOOK ERROR : ' + error + 'body : ' + msg.body });
            });
        }
      } else {
        console.log(msg.type);
      }
    }
  });

  client.on('disconnected', (reason) => {
    console.log(id + ' DISCONNECTED ' + reason);
    io.emit('message', { id: id, text: 'Whatsapp is disconnected!' });
    client.destroy();
    client.initialize();

    // Menghapus pada file sessions
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);

    io.emit('remove-session', id);
  });

  // Tambahkan client ke sessions
  sessions.push({
    id: id,
    description: description,
    client: client
  });

  // Menambahkan session ke file
  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

  if (sessionIndex == -1) {
    savedSessions.push({
      id: id,
      description: description,
      webhook: 'www.google.com',
      ready: false,
    });
    setSessionsFile(savedSessions);
  }
}

const init = function (socket) {
  const savedSessions = getSessionsFile();

  if (savedSessions.length > 0) {
    if (socket) {
      /**
       * At the first time of running (e.g. restarting the server), our client is not ready yet!
       * It will need several time to authenticating.
       * 
       * So to make people not confused for the 'ready' status
       * We need to make it as FALSE for this condition
       */
      savedSessions.forEach((e, i, arr) => {
        arr[i].ready = false;
      });

      socket.emit('init', savedSessions);
    } else {
      savedSessions.forEach(sess => {
        createSession(sess.id, sess.description);
      });
    }
  }
}

init();

// Socket IO
io.on('connection', function (socket) {
  init(socket);

  socket.on('create-session', function (data) {
    console.log('Create session: ' + data.id);
    createSession(data.id, data.description);
  });
});
server.listen(port, function () {
  console.log('App running on  http://127.0.0.1:' + port);
});
// index
app.get('/', (req, res) => {
  res.sendFile('index-multiple-account.html', {
    root: __dirname
  });
});
// send message
app.post('/send-message', [
  body('number').notEmpty(),
  body('username').notEmpty(),
  body('message').notEmpty(),
], async (req, res) => {
  // checking error
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.mapped() });
  }
  // get request
  const username = req.body.username;
  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;
  // init client
  const client = sessions.find(sess => sess.id == username)?.client;
  if (!client) {
    return res.status(422).send({
      status: false,
      message: `username : ${username} is not found!`
    })
  }
  // check register number
  const isRegisteredNumber = await client.isRegisteredUser(number);
  if (!isRegisteredNumber) {
    return res.status(422).send({
      status: false,
      message: 'The number is not registered'
    });
  }
  // send messagef
  client.sendMessage(number, message).then(response => {
    io.emit('message', { id: username, text: 'Send Message to ' + number });
    return res.status(200).send({
      status: true,
      response: response
    });
  }).catch(err => {
    return res.status(500).send({
      status: false,
      response: err
    });
  });
});
// send group
app.post('/send-group', [
  body('group').notEmpty(),
  body('username').notEmpty(),
  body('message').notEmpty(),
], async (req, res) => {
  // checking error
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.mapped() });
  }
  // get request
  const username = req.body.username;
  const group = req.body.group;
  const message = req.body.message;
  // init client
  const client = sessions.find(sess => sess.id == username)?.client;
  if (!client) {
    return res.status(422).send({
      status: false,
      message: `username : ${username} is not found!`
    })
  }
  // send message group
  client.sendMessage('120363044576251255@g.us', message).then(response => {
    io.emit('message', { id: username, text: 'Send Message to ' + group });
    return res.status(200).send({
      status: true,
      response: response
    });
  }).catch(err => {
    return res.status(500).send({
      status: false,
      response: err
    });
  });
});
// send media
app.post('/send-media', [
  body('number').notEmpty(),
  body('username').notEmpty(),
  body('caption').notEmpty(),
  body('fileurl').notEmpty(),
], async (req, res) => {
  // checking error
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.mapped() });
  }
  // get request
  const caption = req.body.caption;
  const number = phoneNumberFormatter(req.body.number);
  const fileurl = req.body.fileurl;
  const username = req.body.username;
  // init client
  const client = sessions.find(sess => sess.id == username)?.client;
  if (!client) {
    return res.status(422).send({
      status: false,
      message: `username : ${username} is not found!`
    })
  }
  // check register number
  const isRegisteredNumber = await client.isRegisteredUser(number);
  if (!isRegisteredNumber) {
    return res.status(422).send({
      status: false,
      message: 'The number is not registered'
    });
  }
  // get media from internet
  axios.get(fileurl).then(async axres => {
    const media = await MessageMedia.fromUrl(fileurl, {
      unsafeMime: true
    });
    // send media
    client.sendMessage(number, media, { caption: caption }).then(response => {
      io.emit('message', { id: username, text: 'Send Media to ' + number });
      return res.status(200).send({
        status: true,
        response: response
      });
    }
    ).catch(err => {
      return res.status(500).send({
        status: false,
        response: err
      });
    });
  })
    .catch(err => {
      console.error("Error : " + err);
      return res.status(400).send({
        status: false,
        response: err
      });
    });
});
// send filepath
app.post('/send-filepath', [
  body('number').notEmpty(),
  body('caption').notEmpty(),
  body('filepath').notEmpty(),
  body('username').notEmpty(),
], async (req, res) => {
  // checking error
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.mapped() });
  }
  // get request
  const caption = req.body.caption;
  const number = phoneNumberFormatter(req.body.number);
  const filepath = req.body.filepath;
  const username = req.body.username;
  // init client
  const client = sessions.find(sess => sess.id == username)?.client;
  if (!client) {
    return res.status(422).send({
      status: false,
      message: `username : ${username} is not found!`
    })
  }
  // check register number
  const isRegisteredNumber = await client.isRegisteredUser(number);
  if (!isRegisteredNumber) {
    return res.status(422).send({
      status: false,
      message: 'The number is not registered'
    });
  }
  // get media file path
  const media = MessageMedia.fromFilePath(filepath);
  client.sendMessage(number, media, { caption: caption }).then(response => {
    io.emit('message', { id: username, text: 'Send File Path to ' + number });
    return res.status(200).send({
      status: true,
      response: response
    });
  }).catch(err => {
    console.error("Error : " + err);
    return res.status(400).send({
      status: false,
      response: err
    });
  });
});


