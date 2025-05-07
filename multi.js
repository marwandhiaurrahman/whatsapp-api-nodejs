const { Client, MessageMedia, LocalAuth, Buttons, List } = require('whatsapp-web.js');
const express = require('express');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const { phoneNumberFormatter, groupFormatter } = require('./helpers/formatter');
const fileUpload = require('express-fileupload');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const port = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));
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
const wwebVersion = '2.2412.54';

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
    }),
    webVersionCache: {
      type: 'remote',
      remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${wwebVersion}.html`,
    },
  });
  client.initialize();
  client.on('loading_screen', (percent, message) => {
    console.log(id + ' LOADING SCREEN', percent, message);
    io.emit('message', { id: id, text: 'Load chat ' + percent + '% ' + message });
  });
  client.on('qr', (qr) => {
    // console.log(id + ' QR RECEIVED', qr);
    qrcode.toDataURL(qr, (err, url) => {
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
            qr: qr,
            message: "#qr",
            type: 'qr',
            status: 'Received New QR Login',
            username: id,
          }
        })
          .then(async res => {
            console.log(id + " SEND QR ");
          })
          .catch(async error => {
            console.log(id + ' WEBHOOK QR ERROR : ' + error);
          });
      }
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
    var webhook = savedSessions[sessionIndex].webhook;
    if (webhook) {
      // send weebhook
      axios({
        method: 'post',
        url: webhook,
        data: {
          chatid: 'system',
          number: 'system',
          contact: 'system',
          message: 'system',
          isGroup: 0,
          timestamp: new Date(),
          type: 'info',
          status: 'Status Ready',
          username: id,
        }
      })
        .then(async res => {
          console.log(id + " READY WEBHOOK ");
        })
        .catch(async error => {
          console.log(id + ' WEBHOOK READY ERROR : ' + error);
        });
    }
  });
  client.on('authenticated', () => {
    console.log(id + ' AUTHENTICATED');
    io.emit('authenticated', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is authenticated!' });
  });
  client.on('auth_failure', function () {
    io.emit('message', { id: id, text: 'Auth failure, restarting...' });
  });
  client.on('message', async msg => {
    if (msg.from.endsWith('@c.us') || msg.from.endsWith('@g.us')) {
      io.emit('message', { id: id, text: 'Message ' + msg.type + ' from ' + msg.from + ' body ' + msg.body });
      if (["chat", "image", "video", "list_response", "buttons_response"].includes(msg.type)) {
        const contact = await msg.getContact();
        const name = contact.pushname;
        if (msg.from.endsWith('@c.us')) {
          var isGroup = 0;
        }
        if (msg.from.endsWith('@g.us')) {
          var isGroup = 1;
        }
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
              chatid: msg.id.id,
              number: msg.from,
              contact: name,
              message: msg.body,
              isGroup: isGroup,
              timestamp: msg.timestamp,
              type: 'message',
              status: 'Received Message',
              username: id,
            }
          })
            .then(async res => {
              console.log(id + " SEND WEBHOOOK to " + msg.from);
              io.emit('message', { id: id, text: 'SEND WEBHOOK' });

            })
            .catch(async error => {
              console.log('WEBHOOK ERROR : ' + error + 'body : ' + msg.body);
              io.emit('message', { id: id, text: 'WEBHOOK ERROR : ' + error + 'body : ' + msg.body });
            });
        }
      } else {
        console.log(msg.type + ' from ' + msg.from);
      }
    }
  });
  // let rejectCalls = false;
  // client.on('call', async (call) => {
  //   console.log('Call received, rejecting. GOTO Line 261 to disable', call);
  //   if (rejectCalls) await call.reject();
  //   await client.sendMessage(call.from, `[${call.fromMe ? 'Outgoing' : 'Incoming'}] Phone call from ${call.from}, type ${call.isGroup ? 'group' : ''} ${call.isVideo ? 'video' : 'audio'} call. ${rejectCalls ? 'Nomor ini tidak menerima panggilan. Panggilan ini otomatis ditutup oleh sistem.' : ''}`);
  // });
  client.on('disconnected', (reason) => {
    console.log(id + ' DISCONNECTED ' + reason);
    io.emit('message', { id: id, text: 'Whatsapp is disconnected!' });
    client.destroy();
    client.initialize();

    // Menghapus pada file sessions
    // const savedSessions = getSessionsFile();
    // const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    // savedSessions.splice(sessionIndex, 1);
    // setSessionsFile(savedSessions);
    // io.emit('remove-session', id);
  });
  // Tambahkan client ke sessions
  sessions.push({
    id: id,
    description: description,
    webhook: webhook,
    client: client
  });
  // Menambahkan session ke file
  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
  if (sessionIndex == -1) {
    savedSessions.push({
      id: id,
      description: description,
      webhook: webhook,
      ready: false,
    });
    setSessionsFile(savedSessions);
  }
}
const init = function (socket) {
  const savedSessions = getSessionsFile();
  if (savedSessions.length > 0) {
    if (socket) {
      savedSessions.forEach((e, i, arr) => {
        arr[i].ready = false;
      });

      socket.emit('init', savedSessions);
    } else {
      savedSessions.forEach(sess => {
        createSession(sess.id, sess.description, sess.webhook);
      });
    }
  }
}
// Socket IO
init();
io.on('connection', function (socket) {
  init(socket);
  socket.on('create-session', function (data) {
    console.log('Create session: ' + data.id);
    createSession(data.id, data.description, data.webhook);
  });

  // Tambahkan handler untuk update webhook
  socket.on('update-webhook', function (data) {
    console.log('Update webhook for session: ' + data.id);
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id === data.id);

    if (sessionIndex !== -1) {
      savedSessions[sessionIndex].webhook = data.webhook;
      setSessionsFile(savedSessions);
      console.log(`Webhook updated for session ${data.id}`);
    } else {
      console.log(`Session ${data.id} not found!`);
    }
  });
});
server.listen(port, function () {
  console.log('App running on  http://127.0.0.1:' + port);
});
// index
app.get('/', (req, res) => {
  res.sendFile('index-wa.html', {
    root: __dirname
  });
});
app.get('/session', (req, res) => {
  res.sendFile('index-multiple-account.html', {
    root: __dirname
  });
});
// send notif group
app.post('/notif', [
  body('message').notEmpty(),
], async (req, res) => {
  const message = req.body.message;
  // // send message
  const username = req.body.username;
  const client = sessions.find(sess => sess.id == username)?.client;
  client.sendMessage("120363044576251255@g.us", message)
    .then(
      (response) => {
        return res.send(response);
      }
    ).catch(
      (error) => {
        return res.send("Error : " + error);
      }
    );
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
  // const isRegisteredNumber = await client.isRegisteredUser(number);
  // if (!isRegisteredNumber) {
  //   return res.status(422).send({
  //     status: false,
  //     message: 'The number is not registered'
  //   });
  // }
  // send message
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
app.post('/send-message-group', [
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
  const group = groupFormatter(req.body.group);
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
  client.sendMessage(group, message).then(response => {
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
// send list button
app.post('/send-list', [
  body('number').notEmpty(),
  body('contenttext').notEmpty(),
  body('buttontext').notEmpty(),
  body('rowtitle').notEmpty(),
  body('username').notEmpty(),
], async (req, res) => {
  // checking error
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.mapped() });
  }
  // get request
  const username = req.body.username;
  const number = phoneNumberFormatter(req.body.number);
  let rowtitles = req.body.rowtitle;
  // get list
  let rows = [];
  let i = 1;
  // get ow title belakang koma
  if (rowtitles.slice(-1) == ",") {
    rowtitles = rowtitles.slice(0, -1)
  }
  // get row desc null
  if (req.body.rowdescription == null) {
    rowdescription = '';
  } else {
    rowdescription = req.body.rowdescription.split(',');
  }
  rowtitles.split(',').forEach(element => {
    let description = rowdescription[i - 1] || '';
    let rowid = {
      title: element,
      description: description,
      id: 'rowid' + i++,
    };
    rows.push(rowid);
  });
  const section = {
    title: req.body.titlesection,
    rows: rows,
  };
  const list = new List(req.body.contenttext, req.body.buttontext, [section], req.body.titletext, req.body.footertext)
  // init client
  const client = sessions.find(sess => sess.id == username)?.client;
  if (!client) {
    return res.status(422).send({
      status: false,
      message: `username : ${username} is not found!`
    })
  }
  // check register number
  // const isRegisteredNumber = await client.isRegisteredUser(number);
  // if (!isRegisteredNumber) {
  //   return res.status(422).send({
  //     status: false,
  //     message: 'The number is not registered'
  //   });
  // }
  // send list
  await client.sendMessage(number, list)
    .then(
      (response) => {
        console.log('SEND LIST');
        return res.send(response);
      }
    ).catch(
      (error) => {
        console.log("Error : " + error);
        return res.send("Error : " + error);
      }
    );
});
// send button
app.post('/send-button', [
  body('number').notEmpty(),
  body('contenttext').notEmpty(),
  body('buttontext').notEmpty(),
  body('username').notEmpty(),
], async (req, res) => {
  // checking error
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.mapped() });
  }
  // get request
  const username = req.body.username;
  const number = phoneNumberFormatter(req.body.number);
  // gets button
  let buttons = [];
  let i = 1;
  req.body.buttontext.split(',').forEach(element => {
    let buttonid = {
      body: element,
      id: 'buttonid' + i++,
    };
    buttons.push(buttonid);
  });
  const buttons_reply = new Buttons(req.body.contenttext, buttons, req.body.titletext, req.body.footertext);
  // init client
  const client = sessions.find(sess => sess.id == username)?.client;
  if (!client) {
    return res.status(422).send({
      status: false,
      message: `username : ${username} is not found!`
    })
  }
  // check register number
  // const isRegisteredNumber = await client.isRegisteredUser(number);
  // if (!isRegisteredNumber) {
  //   return res.status(422).send({
  //     status: false,
  //     message: 'The number is not registered'
  //   });
  // }
  // send button
  await client.sendMessage(number, buttons_reply)
    .then(
      (response) => {
        console.log('SEND BUTTON');
        return res.send(response);
      }
    ).catch(
      (error) => {
        console.log("Error : " + error);
        return res.send("Error : " + error);
      }
    );
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
  // const isRegisteredNumber = await client.isRegisteredUser(number);
  // if (!isRegisteredNumber) {
  //   return res.status(422).send({
  //     status: false,
  //     message: 'The number is not registered'
  //   });
  // }
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
  // const isRegisteredNumber = await client.isRegisteredUser(number);
  // if (!isRegisteredNumber) {
  //   return res.status(422).send({
  //     status: false,
  //     message: 'The number is not registered'
  //   });
  // }
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