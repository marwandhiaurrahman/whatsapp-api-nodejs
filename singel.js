const qrcode = require('qrcode-terminal');
const { Client, Location, MessageMedia, List, Buttons, LocalAuth } = require('whatsapp-web.js');

const client = new Client({
    authStrategy: new LocalAuth({ clientId: "client-one" }),
    webVersionCache: { type: 'remote', remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html', }
});
client.initialize();
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('QR RECEIVED', qr);
});
client.on('authenticated', (session) => {
    console.log('AUTHENTICATED ', session);
});
client.on('auth_failure', msg => {
    console.error('AUTHENTICATION FAILURE', msg);
});
client.on('ready', () => {
    console.log('READY');
});
client.on('disconnected', (reason) => {
    console.log('Client was logged out', reason);
});
client.on('message', message => {
    console.log(message.body);
    if (message.body === '!ping') {
        client.sendMessage(message.from, 'pong');
    }
});

// api
const axios = require('axios');
const express = require('express')
const { body, validationResult } = require('express-validator');
const { phoneNumberFormatter } = require('./helpers/formatter');

const app = express();
const port = 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.listen(port, () => {
    console.log("Example app listening on http://127.0.0.1:" + port)
});
// index
app.get('/', (req, res) => {
    axios
        .get('https://dog.ceo/api/breeds/image/random')
        .then(res => {
            console.log(res.data);
        })
        .catch(error => {
            console.error("Error : " + error);
        });
    return res.send(res.data);
});
// send message
app.post('/test', [
    body('message').notEmpty(),
], async (req, res) => {
    const message = req.body.message;
    // // send message
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
// send notif group
app.post('/notif', [
    body('message').notEmpty(),
], async (req, res) => {
    const message = req.body.message;
    // // send message
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
    body('message').notEmpty(),
], async (req, res) => {
    // checking error
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.mapped() });
    }
    // init client
    const number = phoneNumberFormatter(req.body.number);
    const message = req.body.message;
    // send message
    client.sendMessage(number, message)
        .then(
            (response) => {
                console.log('SEND MESSAGE');
                return res.send(response);
            }
        ).catch(
            (error) => {
                return res.send("Error : " + error);
            }
        );
});
// send list button
app.post('/send-list', [
    body('number').notEmpty(),
    body('contenttext').notEmpty(),
    body('buttontext').notEmpty(),
    body('rowtitle').notEmpty(),
], async (req, res) => {
    // checking error
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.mapped() });
    }
    // init client
    const number = phoneNumberFormatter(req.body.number);
    let rowtitles = req.body.rowtitle;
    // init list
    let rows = [];
    let i = 1;
    // row title belakang koma
    if (rowtitles.slice(-1) == ",") {
        rowtitles = rowtitles.slice(0, -1)
    }
    // row desc null
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
], async (req, res) => {
    // checking error
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.mapped() });
    }
    // init client
    const number = phoneNumberFormatter(req.body.number);
    // button button
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
    body('caption').notEmpty(),
    body('fileurl').notEmpty(),
], async (req, res) => {
    // checking error
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.mapped() });
    }
    // init client
    const caption = req.body.caption;
    const number = phoneNumberFormatter(req.body.number);
    const fileurl = req.body.fileurl;

    axios.get(fileurl)
        .then(async axres => {
            const media = await MessageMedia.fromUrl(fileurl, {
                unsafeMime: true
            });
            return client.sendMessage(number, media, { caption: caption })
                .then(
                    (response) => {
                        console.log('SEND MEDIA');
                        return res.send(response);
                    }
                ).catch(
                    (error) => {
                        return res.send("Error : " + error);
                    }
                );
        })
        .catch(axerror => {
            console.error("Error : " + axerror);
            return res.status(400).json({ error: axerror });
        });
});
// send filepath
app.post('/send-filepath', [
    body('number').notEmpty(),
    body('caption').notEmpty(),
    body('filepath').notEmpty(),
], async (req, res) => {
    // checking error
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.mapped() });
    }
    // init client
    const caption = req.body.caption;
    const number = phoneNumberFormatter(req.body.number);
    const filepath = req.body.filepath;

    const media = MessageMedia.fromFilePath(filepath);
    return client.sendMessage(number, media, { caption: caption })
        .then(
            (response) => {
                console.log('SEND FILE PATH');
                return res.send(response);
            }
        ).catch(
            (error) => {
                return res.send("Error : " + error);
            }
        );
});
